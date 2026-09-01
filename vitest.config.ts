import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Server code + shared pure-logic libs (no DOM). No frontend component tests.
    include: ["src/server/**/*.test.ts", "src/lib/**/*.test.ts"],
    // Vários testes sobem um Postgres em memória (pglite / WASM) com cold start
    // lento, e o gerador de DANFSe (pdf-lib) faz subsetting de fonte. Sob
    // paralelismo alto isso estoura o timeout padrão de 5 s. Limitar os forks
    // reduz a contenção; um teto de timeout maior cobre o cold start.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    poolOptions: { forks: { maxForks: 4 } },
  },
});
