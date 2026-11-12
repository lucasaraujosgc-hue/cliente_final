import { cnpjValido, cpfValido, limparInscricao } from "../../../lib/inscricao";
import { lookupCnpj, type TomadorLookup } from "./cnpjLookup";
import type { DpsTomador } from "./dps";
import { NfseError } from "./errors";
import { tomadorExigeEndereco } from "./regras";

// Tomador da NFS-e a partir do que o usuário informa na emissão: CNPJ, CPF ou
// nenhum (consumidor não identificado — o grupo "toma" é opcional na DPS).
// Endereço, telefone e e-mail não são pedidos. O endereço só vai na DPS quando
// a Sefin exige (ISS retido ou serviço 17.05.01 — ver tomadorExigeEndereco), e
// então vem do cadastro CNPJ da Receita.

export interface TomadorInformado {
  doc?: string | null;
  nome?: string | null; // CPF: obrigatório; CNPJ: a razão social confirmada na tela
}

const erro = (msg: string, reason: string) => new NfseError(msg, { status: 400, reason });

export async function resolverTomador(
  t: TomadorInformado | null | undefined,
  atividade: { codTributacaoNac?: string | null; itemListaServico?: string | null; issRetido: boolean },
  buscar: (cnpj: string) => Promise<TomadorLookup> = lookupCnpj,
): Promise<DpsTomador | null> {
  const exige = tomadorExigeEndereco(atividade.codTributacaoNac || atividade.itemListaServico, atividade.issRetido);
  const doc = limparInscricao(t?.doc);
  const nome = String(t?.nome ?? "").trim();
  const motivo = atividade.issRetido ? "o ISS é retido pelo tomador" : "o imposto é devido no endereço do tomador (17.05.01)";

  if (!doc) {
    if (exige) throw erro(`Nesta atividade ${motivo}: informe o CNPJ do tomador.`, "tomador_obrigatorio");
    return null; // sem tomador
  }

  if (doc.length === 11) {
    if (!cpfValido(doc)) throw erro("CPF do tomador inválido — confira os números.", "tomador_doc");
    if (exige) {
      throw erro(`Nesta atividade ${motivo}, e a nota precisa do endereço do tomador — informe o CNPJ dele (com CPF não há como obter o endereço).`, "tomador_obrigatorio");
    }
    if (!nome) throw erro("Informe o nome do tomador (obrigatório na nota quando ele é identificado pelo CPF).", "tomador_nome");
    return { doc, nome };
  }

  if (!cnpjValido(doc)) throw erro("CNPJ do tomador inválido — confira os números.", "tomador_doc");
  let razao = nome;
  let endereco: DpsTomador["endereco"] = null;
  if (!razao || exige) {
    const r = await buscar(doc).catch(() => null);
    razao = razao || r?.razaoSocial?.trim() || "";
    if (exige) {
      const e = r?.endereco;
      const completo =
        !!e && !!e.logradouro && !!e.bairro && String(e.codigoMunicipio || "").length === 7 && String(e.cep || "").replace(/\D/g, "").length === 8;
      if (!completo) {
        throw new NfseError(
          `Nesta atividade ${motivo}, e a nota precisa do endereço do tomador — não foi possível obtê-lo no cadastro do CNPJ agora. Tente de novo em instantes.`,
          { status: 502, reason: "tomador_endereco" },
        );
      }
      // Sem número no cadastro ("S/N") a DPS ainda exige o campo.
      endereco = { ...e!, numero: e!.numero || "S/N" };
    }
  }
  if (!razao) throw erro("Informe a razão social do tomador.", "tomador_nome");
  return { doc, nome: razao, endereco };
}
