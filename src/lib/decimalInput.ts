// Campo decimal em pt-BR enquanto o usuário digita.
//
// Um <input> controlado por NÚMERO não deixa digitar o separador: "2," vira o
// número 2, o campo volta a mostrar "2" e a vírgula some na hora (era o que
// acontecia na Alíquota ISS). O campo precisa guardar o TEXTO; estas funções
// fazem a ponte texto ⇄ número.

/** Mantém só dígitos e um separador (vírgula; ponto digitado vira vírgula). */
export function sanitizeDecimalText(raw: string, maxDecimals = 4): string {
  const s = String(raw ?? "").replace(/\./g, ",").replace(/[^\d,]/g, "");
  const at = s.indexOf(",");
  if (at < 0) return s;
  return s.slice(0, at) + "," + s.slice(at + 1).replace(/,/g, "").slice(0, maxDecimals);
}

/** "2,5" → 2.5 · "2," → 2 · "" → 0 */
export function decimalTextToNumber(text: string): number {
  const n = Number(sanitizeDecimalText(text, 20).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** 2.5 → "2,5" · 0/null → "0" */
export function numberToDecimalText(n: number | null | undefined): string {
  return Number.isFinite(n as number) ? String(n).replace(".", ",") : "0";
}
