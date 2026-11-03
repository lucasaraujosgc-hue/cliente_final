// Grupos de detalhamento do serviço e local de incidência da NFS-e Nacional —
// usados no servidor (montagem da DPS) e na tela (o que a emissão pede).
// Anexo I v1.01, folha MUN.INCID_INFO.SERV. e regras E0370/E0390/E1317.

/** E0370: o grupo `obra` é obrigatório nestes códigos (E0372: proibido nos demais, salvo 99.01.01). */
export const CODIGOS_OBRA = new Set([
  "070201", "070202", "070401", "070501", "070502", "070601", "070602",
  "070701", "070801", "071701", "071901", "141403", "141404",
]);

/**
 * E1317: nestes códigos o ISS é devido no LOCAL DA PRESTAÇÃO (cLocPrestacao),
 * não no município do prestador — serviço feito em outra cidade paga ISS lá.
 */
export const CODIGOS_ISS_NO_LOCAL = new Set(
  (
    "030401 030402 030403 030501 070201 070202 070401 070501 070502 070901 070902 " +
    "071001 071002 071101 071102 071201 071601 071701 071801 071901 110101 110102 " +
    "110201 110301 110401 110402 120101 120201 120301 120401 120501 120601 120701 " +
    "120801 120901 120902 120903 121001 121101 121201 121401 121501 121601 121701 " +
    "160101 160102 160103 160104 160201 171001 171002 220101"
  ).split(" "),
);

const cod6 = (c: string | null | undefined) => {
  let d = String(c ?? "").replace(/\D/g, "");
  if (d.length === 4) d += "01"; // item da LC 116 ("12.12") → 1º desdobro
  return d;
};

/**
 * Grupo que a DPS exige para o código:
 *   "obra"   — construção civil e congêneres (E0370)
 *   "evento" — item 12, diversões/eventos (E0390)
 */
export function grupoDoServico(cTribNac: string | null | undefined): "obra" | "evento" | null {
  const c = cod6(cTribNac);
  if (CODIGOS_OBRA.has(c)) return "obra";
  if (c.length === 6 && c.startsWith("12")) return "evento";
  return null;
}

/** O ISS deste código é devido no local da prestação (E1317)? */
export function issNoLocalDaPrestacao(cTribNac: string | null | undefined): boolean {
  return CODIGOS_ISS_NO_LOCAL.has(cod6(cTribNac));
}
