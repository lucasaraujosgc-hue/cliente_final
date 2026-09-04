// Log técnico da NFS-e. Estruturado, single-line, sem dados sensíveis.
//
// NUNCA logar: XML assinado, PEM/chave privada, senha ou bytes do certificado,
// corpo bruto de resposta que possa conter dados do tomador. Só metadados de
// diagnóstico (idDps, ambiente, status HTTP, códigos de alerta/rejeição,
// latência). O detalhe legível para o usuário vai para nfse_emissoes.

type Level = "info" | "warn" | "error";

export function nfseLog(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = { ts: new Date().toISOString(), scope: "nfse", event };
  // `body` carrega a resposta crua do Sefin — não truncar tanto.
  const cap = (k: string) => (k === "body" || k === "rawBody" ? 6000 : 400);
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.length > cap(k)) safe[k] = v.slice(0, cap(k)) + "…";
    else safe[k] = v;
  }
  const line = JSON.stringify(safe);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
