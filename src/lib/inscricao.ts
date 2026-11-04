// CPF / CNPJ do tomador da NFS-e — compartilhado entre o app e o servidor.
// O CNPJ pode ser alfanumérico (novos cadastros a partir de jul/2026): 12
// posições letras/números + 2 dígitos verificadores numéricos.

/** Maiúsculas, só letras e números. */
export const limparInscricao = (v: string | null | undefined): string =>
  String(v ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");

export function cpfValido(v: string | null | undefined): boolean {
  const s = limparInscricao(v);
  if (!/^\d{11}$/.test(s) || /^(\d)\1{10}$/.test(s)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(s[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(s[9]) && dv(10) === Number(s[10]);
}

/** CNPJ numérico ou alfanumérico (valor de cada caractere = código ASCII − 48). */
export function cnpjValido(v: string | null | undefined): boolean {
  const s = limparInscricao(v);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(s) || /^(\d)\1{13}$/.test(s)) return false;
  const dv = (base: string, pesos: number[]) => {
    const soma = [...base].reduce((acc, c, i) => acc + (c.charCodeAt(0) - 48) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(s.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(s.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return s.endsWith(`${d1}${d2}`);
}

/** "52998224725" → "529.982.247-25"; CNPJ (também alfanumérico) → "12.ABC.345/01DE-35". */
export function formatarInscricao(v: string | null | undefined): string {
  const s = limparInscricao(v);
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  return String(v ?? "");
}
