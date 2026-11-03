// Filtro + paginação das listas de NFS-e (app do cliente e painel do contador).

export interface FiltroNotas {
  texto: string; // nome ou CPF/CNPJ da outra parte (tomador nas emitidas, prestador nas recebidas)
  de: string; // data de emissão inicial, "AAAA-MM-DD" (input date)
  ate: string; // data de emissão final, "AAAA-MM-DD"
  valorMin: string; // em reais, "1.234,56" ou "1234.56"
  valorMax: string;
}

export const FILTRO_VAZIO: FiltroNotas = { texto: "", de: "", ate: "", valorMin: "", valorMax: "" };
export const NOTAS_POR_PAGINA = 5;

export const filtroAtivo = (f: FiltroNotas) => Object.values(f).some((v) => String(v).trim() !== "");

interface NotaFiltravel {
  tomadorNome?: string | null;
  tomadorDoc?: string | null;
  prestadorNome?: string | null;
  prestadorDoc?: string | null;
  dataEmissao?: string | null;
  createdAt?: string | null;
  valorServicos?: number | null; // centavos
}

/** "1.234,56" / "1234.56" / "1234" → centavos; vazio/ inválido → null. */
export function reaisParaCentavos(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Data de emissão como "AAAA-MM-DD" no fuso local. */
function diaDe(n: NotaFiltravel): string | null {
  const v = n.dataEmissao || n.createdAt;
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `parte`: quem aparece na lista — "tomador" (notas emitidas) ou "prestador" (recebidas). */
export function filtrarNotas<T extends NotaFiltravel>(notas: T[], f: FiltroNotas, parte: "tomador" | "prestador" = "tomador"): T[] {
  const texto = semAcento(f.texto.trim());
  const textoDigitos = f.texto.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const min = reaisParaCentavos(f.valorMin);
  const max = reaisParaCentavos(f.valorMax);
  return notas.filter((n) => {
    if (texto) {
      const nome = semAcento(String((parte === "tomador" ? n.tomadorNome : n.prestadorNome) ?? (parte === "tomador" ? "sem tomador" : "")));
      const doc = String((parte === "tomador" ? n.tomadorDoc : n.prestadorDoc) ?? "").toUpperCase();
      const casaDoc = textoDigitos.length >= 3 && /\d/.test(textoDigitos) && doc.includes(textoDigitos);
      if (!nome.includes(texto) && !casaDoc) return false;
    }
    if (f.de || f.ate) {
      const dia = diaDe(n);
      if (!dia) return false;
      if (f.de && dia < f.de) return false;
      if (f.ate && dia > f.ate) return false;
    }
    const valor = n.valorServicos ?? 0;
    if (min != null && valor < min) return false;
    if (max != null && valor > max) return false;
    return true;
  });
}

export function paginar<T>(itens: T[], pagina: number, porPagina = NOTAS_POR_PAGINA) {
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));
  const atual = Math.min(Math.max(1, pagina), totalPaginas);
  return { itens: itens.slice((atual - 1) * porPagina, atual * porPagina), pagina: atual, totalPaginas };
}

/**
 * Nome legível do PDF da nota: "NFS-e 43 - TOMADORA EXEMPLO LTDA - 02-11-2026".
 * Nas recebidas, o nome do prestador. Sem caracteres que o sistema de arquivos recusa.
 */
export function nomeArquivoNfse(n: NotaFiltravel & { numeroNota?: string | null; papel?: string | null }): string {
  const outro = n.papel === "tomador" ? n.prestadorNome : n.tomadorNome || (n.tomadorDoc ? null : "Sem tomador");
  const dia = diaDe(n);
  const data = dia ? dia.split("-").reverse().join("-") : null;
  const partes = [n.numeroNota ? `NFS-e ${n.numeroNota}` : "NFS-e", outro, data].filter(Boolean) as string[];
  return partes
    .join(" - ")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
