import { NfseError } from "./errors";

// Regras de preenchimento da DPS que dependem do REGIME do prestador.
//
// Fonte: Anexo I (docs/nfse-nacional/02-leiautes/anexo_i-sefin_adn-dps_nfse…xlsx,
// folha de regras da DPS). Cada função cita o código da rejeição que evita.
// Todas valem para tpEmit = 1 (o emitente é o próprio prestador), o único modo
// que este sistema emite.
//
// Ficaram aqui, como funções puras, porque a DPS era montada "campo por campo"
// e a Sefin recusou a mesma nota quatro vezes seguidas em produção (out/2026):
// E0166, E0625, E0712 e, na fila, E0235.

/** opSimpNac: 1 = não optante · 2 = MEI · 3 = Simples Nacional ME/EPP */
export type OpSimpNac = "1" | "2" | "3";

/**
 * regApTribSN — regime de apuração dos tributos pelo Simples.
 *   E0166: obrigatório quando opSimpNac = 3.
 *   E0162: proibido quando opSimpNac = 1 ou 2.
 * Sem valor configurado na atividade, vale "1" (tributos federais e ISSQN
 * apurados pelo SN) — a situação de quem não estourou o sublimite.
 */
export function resolveRegApTribSN(op: OpSimpNac, configurado?: string | null): "1" | "2" | "3" | null {
  if (op !== "3") return null;
  const v = String(configurado ?? "").trim();
  return v === "2" || v === "3" ? v : "1";
}

export interface AliquotaContexto {
  op: OpSimpNac;
  regApTribSN: "1" | "2" | "3" | null;
  tribISSQN: string; // "1" = operação tributável
  regEspTrib: string; // "0" = nenhum
  issRetido: boolean;
  /**
   * O município de incidência tem convênio ativo no sistema nacional? Só pesa
   * fora do "SN com ISS pelo SN". `null` = não deu para consultar; tratamos
   * como ativo, porque emitir pela Sefin Nacional já pressupõe isso (E0037/E0038).
   */
  municipioConveniado?: boolean | null;
}

/**
 * pAliq (alíquota do ISSQN na DPS) — "obrigatoria" ou "proibida".
 *   E0602  operação não tributável ........................... proibida
 *   E0600  MEI ............................................... proibida
 *   E0604  regime especial de tributação ..................... proibida
 *   SN ME/EPP, ISS apurado pelo SN (regApTribSN = 1):
 *     E0621/E0628  com retenção ............................. obrigatória (mín. 1,8%)
 *     E0625/E0631  sem retenção ............................. proibida
 *   SN ME/EPP com ISS fora do SN (regApTribSN = 2/3) e não optante:
 *     E0635/E0617  convênio ativo (a Sefin usa a alíquota do município) proibida
 *     E0640/E0619  convênio não ativo ....................... obrigatória
 */
export function regraAliquota(c: AliquotaContexto): "obrigatoria" | "proibida" {
  if (c.tribISSQN !== "1") return "proibida";
  if (c.op === "2") return "proibida";
  if (String(c.regEspTrib || "0") !== "0") return "proibida";
  if (c.op === "3" && c.regApTribSN === "1") return c.issRetido ? "obrigatoria" : "proibida";
  return c.municipioConveniado === false ? "obrigatoria" : "proibida";
}

/** Alíquota mínima aceita quando o SN retém o ISS (obs. das regras E0621/E0628). */
export const ALIQUOTA_MIN_SN_RETIDO = 1.8;

export type TotTrib = { campo: "pTotTribSN"; valor: string } | { campo: "indTotTrib"; valor: "0" };

/**
 * totTrib — valor aproximado dos tributos (Lei 12.741/2012). É um `choice`:
 *   E0712  ME/EPP ........ `indTotTrib` proibido → informa `pTotTribSN`
 *   E0710  MEI ........... `pTotTribSN` proibido → `indTotTrib = 0`
 *   E0713  não optante ... os dois proibidos (exige vTotTrib/pTotTrib por esfera —
 *          ainda não suportado; mantém `indTotTrib` e a Sefin recusa com E0713).
 * `pTotTribSN` é o percentual aproximado dos tributos pela alíquota do Simples:
 * quem informa é o contador, na atividade. Sem ele não há valor honesto a
 * declarar, então a emissão para ME/EPP para aqui com mensagem clara.
 */
export function resolveTotTrib(op: OpSimpNac, pTotTribSN?: number | null): TotTrib {
  if (op !== "3") return { campo: "indTotTrib", valor: "0" };
  const p = Number(pTotTribSN);
  if (!Number.isFinite(p) || p <= 0 || p >= 100) {
    throw new NfseError(
      "Falta o percentual aproximado de tributos do Simples Nacional nesta atividade. O escritório precisa preencher “Tributos aproximados — Simples (%)” no cadastro da atividade.",
      { status: 400, reason: "ptottribsn_ausente" },
    );
  }
  // TSDec2V2: 0 | 0.NN | 1–99 com 2 casas opcionais.
  return { campo: "pTotTribSN", valor: p.toFixed(2) };
}

/**
 * Endereço nacional do tomador.
 *   E0235  tomador identificado por CNPJ (tpEmit = 1) ...... obrigatório
 *   E0237  ISSQN retido pelo tomador ....................... obrigatório
 */
export function tomadorExigeEndereco(tomadorEhCnpj: boolean, issRetido: boolean): boolean {
  return tomadorEhCnpj || issRetido;
}
