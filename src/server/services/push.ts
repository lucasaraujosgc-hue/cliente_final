import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "../db";
import { subscriptions, notificationLog, clients } from "../schema";

// Push para o cliente por dois canais:
//   - FCM (Firebase Admin) → app Android/iOS (token em subscriptions.fcm_token)
//   - Web Push (VAPID)     → navegador / PWA (subscriptions.subscription_object)
// O estado de cada canal fica em `pushStatus()` para a tela de Dispositivos.

type SubRow = typeof subscriptions.$inferSelect;

// --- Firebase Admin -------------------------------------------------------------

const firebase = { configurado: false, projectId: null as string | null, erro: null as string | null };

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Handle escaped newlines in the private key
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    firebase.configurado = true;
    firebase.projectId = process.env.FIREBASE_PROJECT_ID;
    console.log(`Firebase Admin initialized successfully (projeto ${firebase.projectId}).`);
  } catch (error) {
    // Só a mensagem: o erro do cert() não traz a chave.
    firebase.erro = error instanceof Error ? error.message.slice(0, 300) : String(error);
    console.error("Firebase Admin initialization error:", firebase.erro);
  }
} else {
  firebase.erro = "FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY não configuradas no servidor";
  console.warn(`Push no app desligado: ${firebase.erro}.`);
}

const fcmAtivo = () => getApps().length > 0;

// --- Web Push (VAPID) -----------------------------------------------------------

// Sem as chaves no ambiente, gera um par só para esta execução: cada restart
// troca a chave e as inscrições de navegador feitas antes deixam de funcionar.
const vapidFixas = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || "",
  privateKey: process.env.VAPID_PRIVATE_KEY || "",
};

if (!vapidFixas) {
  vapidKeys = webpush.generateVAPIDKeys();
  // Nunca a chave privada no log.
  console.warn("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes: chaves temporárias geradas para esta execução.");
}

webpush.setVapidDetails(
  "mailto:lucasdocarbono@gmail.com",
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

export { vapidKeys, webpush };

export function pushStatus() {
  return {
    firebase: { ...firebase, ativo: fcmAtivo() },
    webPush: { chavesFixas: vapidFixas, chavePublicaInicio: vapidKeys.publicKey.slice(0, 12) },
  };
}

// --- Entrega --------------------------------------------------------------------

export interface ResultadoEntrega {
  subscriptionId: string;
  canal: "app" | "navegador";
  ok: boolean;
  erro: string | null; // código do FCM / status do web push
  removida: boolean; // inscrição inválida apagada
}

// Token/inscrição que o serviço diz não existir mais: apaga para não tentar de novo.
const FCM_TOKEN_INVALIDO = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

async function entregar(sub: SubRow, title: string, body: string, opts: { dryRun?: boolean } = {}): Promise<ResultadoEntrega[]> {
  const out: ResultadoEntrega[] = [];
  if (sub.subscriptionObject && !opts.dryRun) {
    try {
      await webpush.sendNotification(sub.subscriptionObject as webpush.PushSubscription, JSON.stringify({ title, body }));
      out.push({ subscriptionId: sub.id, canal: "navegador", ok: true, erro: null, removida: false });
    } catch (err: any) {
      const removida = err?.statusCode === 410 || err?.statusCode === 404;
      if (removida) await db.delete(subscriptions).where(eq(subscriptions.id, sub.id));
      out.push({ subscriptionId: sub.id, canal: "navegador", ok: false, erro: `HTTP ${err?.statusCode ?? "?"}`, removida });
      console.error("push.web.falhou", { sub: sub.id, status: err?.statusCode });
    }
  }
  if (sub.fcmToken) {
    if (!fcmAtivo()) {
      out.push({ subscriptionId: sub.id, canal: "app", ok: false, erro: "firebase_nao_configurado", removida: false });
    } else {
      try {
        await getMessaging().send({ token: sub.fcmToken, notification: { title, body } }, !!opts.dryRun);
        out.push({ subscriptionId: sub.id, canal: "app", ok: true, erro: null, removida: false });
      } catch (err: any) {
        const codigo = String(err?.code || err?.errorInfo?.code || "erro");
        const removida = FCM_TOKEN_INVALIDO.has(codigo) && !opts.dryRun;
        if (removida) await db.delete(subscriptions).where(eq(subscriptions.id, sub.id));
        out.push({ subscriptionId: sub.id, canal: "app", ok: false, erro: codigo, removida });
        console.error("push.fcm.falhou", { sub: sub.id, codigo });
      }
    }
  }
  return out;
}

export interface ResumoEnvio {
  dispositivos: number;
  entregues: number;
  falhas: number;
  resultados: ResultadoEntrega[];
}

async function entregarPara(subs: SubRow[], title: string, body: string): Promise<ResumoEnvio> {
  const resultados = (await Promise.all(subs.map((s) => entregar(s, title, body)))).flat();
  return {
    dispositivos: subs.length,
    entregues: resultados.filter((r) => r.ok).length,
    falhas: resultados.filter((r) => !r.ok).length,
    resultados,
  };
}

/** Teste de um aparelho (tela Dispositivos). `dryRun`: o FCM valida credenciais e token sem entregar. */
export async function testarDispositivo(subscriptionId: string, opts: { dryRun?: boolean } = {}) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
  if (!sub) return null;
  return entregar(sub, "Teste de notificação", "Se você recebeu esta mensagem, as notificações do portal estão funcionando.", opts);
}

// Registra o aviso no histórico do cliente. Os funis de envio abaixo
// chamam isto ANTES de tentar entregar: o histórico é o que o escritório
// avisou, não prova de entrega — o cliente sem dispositivo cadastrado também
// precisa ver o aviso quando abrir o portal. Nunca derruba o envio.
async function recordNotification(clientIds: string[] | null, title: string, body: string) {
  try {
    const ids = clientIds ?? (await db.select({ id: clients.id }).from(clients)).map((c) => c.id);
    // broadcast: uma linha por cliente, senão ninguém vê no histórico
    if (ids.length) await db.insert(notificationLog).values(ids.map((clientId) => ({ clientId, title, body })));
  } catch (err) {
    console.error("notificationLog: falha ao registrar aviso", err);
  }
}

/** Aviso para alguns clientes (ou todos, com `null`): histórico + push em todos os aparelhos deles. */
export async function enviarParaClientes(clientIds: string[] | null, title: string, body: string): Promise<ResumoEnvio & { clientesSemAparelho: number }> {
  await recordNotification(clientIds, title, body);
  const subs = clientIds
    ? clientIds.length
      ? await db.select().from(subscriptions).where(inArray(subscriptions.clientId, clientIds))
      : []
    : await db.select().from(subscriptions);
  const resumo = await entregarPara(subs, title, body);
  const comAparelho = new Set(subs.map((s) => s.clientId));
  const total = clientIds ? clientIds.length : (await db.select({ id: clients.id }).from(clients)).length;
  return { ...resumo, clientesSemAparelho: Math.max(0, total - comAparelho.size) };
}

// Sends a push (web-push + FCM) notification to every subscription of a given client.
export async function sendClientNotification(clientId: string, title: string, body: string) {
  return enviarParaClientes([clientId], title, body);
}

// Sends a push notification to all subscriptions of a client, or to everyone if clientId is null.
// Used by the background notification sweeper.
export async function sendPushToClients(clientId: string | null, title: string, body: string) {
  try {
    return await enviarParaClientes(clientId ? [clientId] : null, title, body);
  } catch (err) {
    console.error("Erro ao enviar push via sweeper:", err);
    return null;
  }
}
