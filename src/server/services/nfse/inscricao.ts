// Inscrição federal (CNPJ / CPF) para a NFS-e Nacional.
//
// A partir da NT-009 §2.1 todos os campos CNPJ da DPS/NFS-e passaram de numérico
// para CARACTERE, para acomodar o CNPJ alfanumérico (implantação a partir de
// julho/2026). O XSD v1.01 já reflete isso: TSCNPJ = [0-9A-Z]{14}, e a chave de
// acesso / Id da DPS / Id do pedido de evento embutem [0-9A-Z]{14}.
//
// Por isso, no caminho da NFS-e o documento é tratado como STRING — nunca
// `Number(...)` nem regex só-dígitos. `lib/cnpj.ts` (usado no login) continua
// numérico e não é tocado aqui.

/** Mantém apenas [0-9A-Z] (maiúsculas), como exige o padrão do CNPJ alfanumérico. */
export function normalizeInscricao(value: string | null | undefined): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

/** CPF: 11 dígitos numéricos. */
export function isCpf(value: string | null | undefined): boolean {
  return /^[0-9]{11}$/.test(normalizeInscricao(value));
}

/** CNPJ: 14 posições alfanuméricas (numérico ou alfanumérico). */
export function isCnpj(value: string | null | undefined): boolean {
  return /^[0-9A-Z]{14}$/.test(normalizeInscricao(value));
}

/** Tipo de inscrição federal para o Id da DPS/NFS-e: "1" = CPF, "2" = CNPJ. */
export function tipoInscricao(value: string | null | undefined): "1" | "2" {
  return isCpf(value) ? "1" : "2";
}

/**
 * Raiz da inscrição (8 primeiras posições do CNPJ). Usada para conferir se o
 * certificado A1 é da mesma empresa do cliente. Para CPF devolve os 11 dígitos.
 */
export function inscricaoRaiz(value: string | null | undefined): string {
  const v = normalizeInscricao(value);
  return isCpf(v) ? v : v.slice(0, 8);
}

/** True quando `a` e `b` compartilham a raiz do CNPJ (mesma empresa). */
export function inscricaoRaizMatches(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ra = inscricaoRaiz(a);
  const rb = inscricaoRaiz(b);
  return ra.length >= 8 && rb.length >= 8 && ra === rb;
}

/** Completa um CPF com "000" à esquerda para os 14 dígitos do Id (regra oficial). */
export function inscricaoParaId(value: string | null | undefined): string {
  const v = normalizeInscricao(value);
  return isCpf(v) ? v.padStart(14, "0") : v;
}

/** A chave de acesso da NFS-e tem 50 posições: 6 num + 14 alfanum + 30 num. */
export function isChaveAcesso(value: string | null | undefined): boolean {
  return /^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$/.test(normalizeInscricao(value));
}
