// CNPJ is stored digits-only in the DB (14 digits). Format only for display.

export function normalizeCnpj(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

// "12345678000199" -> "12.345.678/0001-99". Leaves anything that isn't 14
// digits untouched so partial input / legacy values still render.
export function formatCnpj(value: string | null | undefined): string {
  const d = normalizeCnpj(value);
  if (d.length !== 14) return String(value ?? "");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// True when `query` (formatted or not) matches a digits-only stored CNPJ.
export function cnpjMatches(storedDigits: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const qDigits = normalizeCnpj(q);
  if (qDigits && storedDigits.includes(qDigits)) return true;
  return formatCnpj(storedDigits).includes(q);
}
