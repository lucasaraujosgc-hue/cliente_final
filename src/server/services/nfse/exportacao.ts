import JSZip from "jszip";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { clients, nfseEmissoes } from "../../schema";

// Download dos XML de NFS-e em .zip, por empresa e período (competência), para
// o contador importar na escrita fiscal. Dentro do zip, separado por papel:
//   Prestados/            notas que a empresa emitiu
//   Prestados/Canceladas/
//   Tomados/              notas que a empresa recebeu (serviço tomado)
//   Tomados/Canceladas/
// Só produção (homologação não tem valor fiscal) e só notas com o XML oficial.

export type TipoXml = "prestados" | "tomados";
const PASTA: Record<TipoXml, string> = { prestados: "Prestados", tomados: "Tomados" };
const PAPEL: Record<TipoXml, string> = { prestados: "prestador", tomados: "tomador" };

/** "2026-11" do registro: a competência gravada (MM/AAAA) ou o mês da emissão (Brasília). */
export function mesDaNota(e: { competencia: string | null; dataEmissao: Date | null; createdAt: Date }): string {
  const m = String(e.competencia ?? "").match(/^(\d{2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1]}`;
  const d = e.dataEmissao ?? e.createdAt;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(d);
}

const noPeriodo = (mes: string, de: string, ate: string) => mes >= de && mes <= ate;

const baseFiltro = and(
  isNotNull(nfseEmissoes.xmlNfse),
  inArray(nfseEmissoes.status, ["emitida", "cancelada"]),
  inArray(nfseEmissoes.papel, ["prestador", "tomador"]),
);
const ehProducao = (amb: string | null) => amb !== "homologacao";

export interface ResumoEmpresa {
  clientId: string;
  nome: string;
  cnpj: string;
  prestados: number;
  tomados: number;
  canceladas: number;
}

/** Quantas notas cada empresa tem no período (só as que têm alguma). */
export async function resumoXml(de: string, ate: string): Promise<ResumoEmpresa[]> {
  const rows = await db
    .select({
      clientId: nfseEmissoes.clientId,
      papel: nfseEmissoes.papel,
      status: nfseEmissoes.status,
      ambiente: nfseEmissoes.ambiente,
      competencia: nfseEmissoes.competencia,
      dataEmissao: nfseEmissoes.dataEmissao,
      createdAt: nfseEmissoes.createdAt,
    })
    .from(nfseEmissoes)
    .where(baseFiltro);
  const porCliente = new Map<string, { prestados: number; tomados: number; canceladas: number }>();
  for (const r of rows) {
    if (!ehProducao(r.ambiente) || !noPeriodo(mesDaNota(r), de, ate)) continue;
    const c = porCliente.get(r.clientId) ?? { prestados: 0, tomados: 0, canceladas: 0 };
    if (r.papel === "prestador") c.prestados++;
    else c.tomados++;
    if (r.status === "cancelada") c.canceladas++;
    porCliente.set(r.clientId, c);
  }
  if (!porCliente.size) return [];
  const cs = await db
    .select({ id: clients.id, name: clients.name, cnpj: clients.cnpj })
    .from(clients)
    .where(inArray(clients.id, [...porCliente.keys()]));
  return cs
    .map((c) => ({ clientId: c.id, nome: c.name, cnpj: c.cnpj, ...porCliente.get(c.id)! }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w .-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const mesBR = (m: string) => `${m.slice(5, 7)}-${m.slice(0, 4)}`;

export interface ZipXml {
  arquivo: string;
  bytes: Buffer;
  prestados: number;
  tomados: number;
}

/** Um .zip com os XML da empresa no período, separados em Prestados/Tomados. Sem nenhuma nota: null. */
export async function zipXmlCliente(clientId: string, de: string, ate: string, tipos: TipoXml[]): Promise<ZipXml | null> {
  const [cliente] = await db.select({ name: clients.name, cnpj: clients.cnpj }).from(clients).where(eq(clients.id, clientId));
  if (!cliente) return null;
  const rows = await db
    .select({
      papel: nfseEmissoes.papel,
      status: nfseEmissoes.status,
      ambiente: nfseEmissoes.ambiente,
      competencia: nfseEmissoes.competencia,
      dataEmissao: nfseEmissoes.dataEmissao,
      createdAt: nfseEmissoes.createdAt,
      numeroNota: nfseEmissoes.numeroNota,
      chaveAcesso: nfseEmissoes.chaveAcesso,
      xml: nfseEmissoes.xmlNfse,
      id: nfseEmissoes.id,
    })
    .from(nfseEmissoes)
    .where(and(eq(nfseEmissoes.clientId, clientId), baseFiltro, inArray(nfseEmissoes.papel, tipos.map((t) => PAPEL[t]))));

  const zip = new JSZip();
  const usados = new Set<string>();
  const cont = { prestados: 0, tomados: 0 };
  for (const r of rows) {
    if (!ehProducao(r.ambiente) || !noPeriodo(mesDaNota(r), de, ate) || !r.xml) continue;
    const tipo: TipoXml = r.papel === "prestador" ? "prestados" : "tomados";
    const pasta = PASTA[tipo] + (r.status === "cancelada" ? "/Canceladas" : "");
    const chave = String(r.chaveAcesso || r.id).replace(/[^0-9A-Za-z]/g, "");
    let nome = `${pasta}/${r.numeroNota ? `NFS-e ${r.numeroNota} - ` : ""}${chave}.xml`;
    for (let i = 2; usados.has(nome); i++) nome = nome.replace(/( \(\d+\))?\.xml$/, ` (${i}).xml`);
    usados.add(nome);
    zip.file(nome, r.xml);
    cont[tipo]++;
  }
  if (!cont.prestados && !cont.tomados) return null;

  const periodo = de === ate ? mesBR(de) : `${mesBR(de)} a ${mesBR(ate)}`;
  const arquivo = `XML NFS-e - ${semAcento(cliente.name).slice(0, 60)} - ${cliente.cnpj.replace(/\W/g, "")} - ${periodo}.zip`;
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { arquivo, bytes, ...cont };
}
