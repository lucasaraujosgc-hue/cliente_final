import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../schema";

const pg = new PGlite();
const testDb = drizzle(pg, { schema });
vi.mock("../../db", () => ({ db: testDb, pool: {} }));

// Web push e Firebase Admin falsos: o que importa aqui é o funil (histórico,
// resumo, limpeza de inscrição inválida), não o transporte.
const webSend = vi.fn();
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: "PUB", privateKey: "PRIV" }),
    setVapidDetails: () => {},
    sendNotification: (...a: any[]) => webSend(...a),
  },
}));
const apps: unknown[] = [];
vi.mock("firebase-admin/app", () => ({
  initializeApp: () => apps.push({}),
  cert: (c: unknown) => c,
  getApps: () => apps,
}));
const fcmSend = vi.fn();
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => ({ send: (...a: any[]) => fcmSend(...a) }) }));

vi.stubEnv("FIREBASE_PROJECT_ID", "portal-teste");
vi.stubEnv("FIREBASE_CLIENT_EMAIL", "sa@portal-teste.iam.gserviceaccount.com");
vi.stubEnv("FIREBASE_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----");

const { enviarParaClientes, testarDispositivo, pushStatus } = await import("../push");
const { clients, subscriptions, notificationLog } = schema;

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DRIZZLE = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));

beforeAll(async () => {
  for (const e of journal.entries) await pg.exec(fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8"));
}, 60_000);

beforeEach(async () => {
  webSend.mockReset().mockResolvedValue({});
  fcmSend.mockReset().mockResolvedValue("projects/x/messages/1");
  await pg.exec("TRUNCATE clients, subscriptions, notification_log RESTART IDENTITY CASCADE;");
  await testDb.insert(clients).values([
    { id: A, cnpj: "11222333000181", name: "Com app", passwordHash: "h", regularityStatus: "green" },
    { id: B, cnpj: "12345678000195", name: "Sem aparelho", passwordHash: "h", regularityStatus: "green" },
  ]);
  await testDb.insert(subscriptions).values([
    { clientId: A, fcmToken: "tok-app", deviceName: "Android" },
    { clientId: A, subscriptionObject: { endpoint: "https://fcm.googleapis.com/x", keys: {} }, deviceName: "Chrome" },
  ]);
});

describe("push", () => {
  it("status: Firebase iniciado com o projeto do ambiente; VAPID temporária sem env", () => {
    const s = pushStatus();
    expect(s.firebase).toMatchObject({ configurado: true, ativo: true, projectId: "portal-teste", erro: null });
    expect(s.webPush.chavesFixas).toBe(false);
  });

  it("registra no histórico de todos os escolhidos e entrega nos aparelhos de quem tem", async () => {
    const r = await enviarParaClientes([A, B], "Aviso", "Corpo");
    expect(r).toMatchObject({ dispositivos: 2, entregues: 2, falhas: 0, clientesSemAparelho: 1 });
    expect(fcmSend).toHaveBeenCalledWith({ token: "tok-app", notification: { title: "Aviso", body: "Corpo" } }, false);
    const log = await testDb.select().from(notificationLog);
    expect(log.map((l) => l.clientId).sort()).toEqual([A, B].sort());
  });

  it("apaga token do app não registrado e inscrição de navegador expirada", async () => {
    fcmSend.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "messaging/registration-token-not-registered" }));
    webSend.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    const r = await enviarParaClientes([A], "Aviso", "Corpo");
    expect(r).toMatchObject({ entregues: 0, falhas: 2 });
    expect(r.resultados.every((x) => x.removida)).toBe(true);
    expect(await testDb.select().from(subscriptions)).toHaveLength(0);
  });

  it("verificação (dryRun) só consulta o Firebase e não mexe no navegador", async () => {
    const alvo = (await testDb.select().from(subscriptions)).find((s) => s.fcmToken)!;
    const r = await testarDispositivo(alvo.id, { dryRun: true });
    expect(r).toEqual([{ subscriptionId: alvo.id, canal: "app", ok: true, erro: null, removida: false }]);
    expect(fcmSend.mock.calls[0][1]).toBe(true);
    expect(webSend).not.toHaveBeenCalled();
    expect(await testDb.select().from(notificationLog)).toHaveLength(0);
  });
});
