// Parses the 50-digit NFS-e access key for display. Layout (Sistema Nacional
// NFS-e):
//   [0..7)   código IBGE do município emissor
//   [7]      ambiente gerador
//   [8]      tipo de inscrição federal do emitente (1=CPF, 2=CNPJ)
//   [9..23)  inscrição federal do emitente (14)
//   [23..36) número da NFS-e (13)
//   [36..40) AAMM da competência/emissão
//   [40..49) código numérico
//   [49]     dígito verificador
//
// Best-effort — only used to render "Nota N · MM/AAAA · município". The
// authoritative número/competência come from the NFS-e XML we persist.

export interface ChaveInfo {
  chave: string;
  codigoMunicipio: string | null;
  inscricaoFederalEmitente: string | null;
  numero: string | null;
  competencia: string | null; // "MM/YYYY"
  dv: string | null;
}

export function parseChaveAcesso(raw: string): ChaveInfo | null {
  const chave = String(raw || "").replace(/\D/g, "");
  if (chave.length !== 50) return null;

  const codigoMunicipio = chave.slice(0, 7);
  const inscricaoFederalEmitente = chave.slice(9, 23).replace(/^0+(?=\d{11})/, "");
  const numero = String(parseInt(chave.slice(23, 36), 10) || 0) || null;
  const aa = chave.slice(36, 38);
  const mm = chave.slice(38, 40);
  const competencia =
    /^\d{2}$/.test(aa) && /^(0[1-9]|1[0-2])$/.test(mm) ? `${mm}/20${aa}` : null;

  return {
    chave,
    codigoMunicipio,
    inscricaoFederalEmitente: inscricaoFederalEmitente || null,
    numero,
    competencia,
    dv: chave.slice(49),
  };
}
