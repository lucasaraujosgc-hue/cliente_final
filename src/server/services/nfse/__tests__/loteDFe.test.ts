import { describe, it, expect } from "vitest";
import { loteDFeTemEnvelope, montarLoteDFe } from "../client";

// O ADN devolve o envelope LoteDistribuicaoNSUResponse mesmo com HTTP 404/400.
// Estas funções puras decidem "é resposta válida?" e montam o lote.

describe("loteDFeTemEnvelope", () => {
  it("aceita o corpo de 'nada localizado' que o ADN manda com HTTP 404", () => {
    const body = {
      StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO",
      LoteDFe: [],
      Alertas: [],
      Erros: [{ Mensagem: {}, Codigo: "E2220", Descricao: "Nenhum documento localizado" }],
      TipoAmbiente: "HOMOLOGACAO",
    };
    expect(loteDFeTemEnvelope(body)).toBe(true);
  });

  it("aceita quando só vem LoteDFe (sem StatusProcessamento)", () => {
    expect(loteDFeTemEnvelope({ LoteDFe: [] })).toBe(true);
    expect(loteDFeTemEnvelope({ loteDFe: [{ NSU: 1 }] })).toBe(true);
  });

  it("rejeita corpo vazio, HTML, ou erro de gateway", () => {
    expect(loteDFeTemEnvelope({})).toBe(false);
    expect(loteDFeTemEnvelope(null)).toBe(false);
    expect(loteDFeTemEnvelope("<html>502 Bad Gateway</html>")).toBe(false);
    expect(loteDFeTemEnvelope({ message: "Unauthorized" })).toBe(false);
  });
});

describe("montarLoteDFe", () => {
  it("'nada localizado' vira lote vazio mantendo o NSU informado", () => {
    const lote = montarLoteDFe(
      { StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO", LoteDFe: [], Erros: [{ Codigo: "E2220" }] },
      7,
    );
    expect(lote.status).toBe("NENHUM_DOCUMENTO_LOCALIZADO");
    expect(lote.docs).toEqual([]);
    expect(lote.ultimoNsu).toBe(7);
  });

  it("ordena os documentos por NSU e usa o maior como ultimoNsu", () => {
    const lote = montarLoteDFe(
      {
        StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
        LoteDFe: [
          { NSU: 12, ChaveAcesso: "b", TipoDocumento: "EVENTO", TipoEvento: "CANCELAMENTO" },
          { NSU: 9, ChaveAcesso: "a", TipoDocumento: "NFSE" },
        ],
      },
      0,
    );
    expect(lote.docs.map((d) => d.nsu)).toEqual([9, 12]);
    expect(lote.docs[0].tipoDocumento).toBe("NFSE");
    expect(lote.docs[1].tipoEvento).toBe("CANCELAMENTO");
    expect(lote.ultimoNsu).toBe(12);
  });
});
