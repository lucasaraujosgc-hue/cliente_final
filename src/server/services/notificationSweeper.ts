import { eq } from "drizzle-orm";
import { differenceInDays, format } from "date-fns";
import { db } from "../db";
import { documents, scheduledNotifications } from "../schema";
import { sendClientNotification, sendPushToClients } from "./push";

const webhookNotificationTimers: Record<string, NodeJS.Timeout> = {};
const webhookNotificationDocs: Record<string, any[]> = {};
export function triggerDebouncedDocumentNotification(doc: any) {
  const clientId = doc.clientId;
  if (!webhookNotificationDocs[clientId]) {
    webhookNotificationDocs[clientId] = [];
  }
  webhookNotificationDocs[clientId].push(doc);

  if (webhookNotificationTimers[clientId]) {
    clearTimeout(webhookNotificationTimers[clientId]);
  }

  webhookNotificationTimers[clientId] = setTimeout(async () => {
    const docs = webhookNotificationDocs[clientId];
    delete webhookNotificationDocs[clientId];
    delete webhookNotificationTimers[clientId];

    try {
      if (docs.length === 1) {
        const rules = await db.select().from(scheduledNotifications)
          .where(eq(scheduledNotifications.type, 'on_file_available'));
        const docObj = docs[0];
        for (const rule of rules) {
          if (!rule.clientId || rule.clientId === clientId) {
            let title = (rule.title || "Nova Guia Disponível")
                        .replace(/\[NOME_GUIA\]/g, docObj.category || "")
                        .replace(/\[CATEGORIA\]/g, docObj.category || "");
            let body = (rule.body || "")
                       .replace(/\[NOME_GUIA\]/g, docObj.category || "")
                       .replace(/\[CATEGORIA\]/g, docObj.category || "")
                       .replace(/\[VENCIMENTO\]/g, docObj.dueDate || "N/A");
            await sendClientNotification(clientId, title, body);
          }
        }
      } else {
        const multiRules = await db.select().from(scheduledNotifications)
          .where(eq(scheduledNotifications.type, 'on_multiple_files_available'));
        let docsList = Array.from(new Set(docs.map((d: any) => d.category || "Documento"))).join(' · ');
        for (const rule of multiRules) {
          if (!rule.clientId || rule.clientId === clientId) {
            let title = (rule.title || `Novos Documentos Recebidos (${docs.length})`)
                        .replace(/\[CATEGORIA\]/g, "Múltiplas Categorias")
                        .replace(/\[NOME_GUIA\]/g, "Vários arquivos")
                        .replace(/\[VENCIMENTO\]/g, "Diversos")
                        .replace(/\[LISTA_GUIAS\]/g, docsList);
            let body = (rule.body || "")
                       .replace(/\[CATEGORIA\]/g, "Múltiplas Categorias")
                       .replace(/\[NOME_GUIA\]/g, "Vários arquivos")
                       .replace(/\[VENCIMENTO\]/g, "Diversos")
                       .replace(/\[LISTA_GUIAS\]/g, docsList);
            await sendClientNotification(clientId, title, body);
          }
        }
      }
    } catch(e) {
      console.error("Error in debounced notification", e);
    }
  }, 30000); // 30 seconds debounce
}

// Background sweeper for notifications
let lastSweepDate = "";

export function parseDueDateString(dateStr: string) {
  if (!dateStr) return null;
  try {
    if (dateStr.includes("/")) {
      const [day, month, year] = dateStr.split("/").map(Number);
      return new Date(year, month - 1, day);
    } else if (dateStr.includes("-")) {
      const parts = dateStr.split("T")[0].split("-");
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
    return new Date(dateStr);
  } catch (e) {
    return null;
  }
}

export function getDaysDiff(dueDateStr: string, today: Date) {
  const parsedDue = parseDueDateString(dueDateStr);
  if (!parsedDue) return -999;
  
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueStart = new Date(parsedDue.getFullYear(), parsedDue.getMonth(), parsedDue.getDate());
  return differenceInDays(dueStart, todayStart);
}

export async function runNotificationSweeper() {
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");

  const brTimeStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
  
  console.log(`[Notification Sweeper] Iniciando varredura (Hora BSB: ${brTimeStr})`);
  try {
    const activeRules = await db
      .select()
      .from(scheduledNotifications)
      .where(eq(scheduledNotifications.active, true));

    for (const rule of activeRules) {
      if (rule.scheduleTime && brTimeStr < rule.scheduleTime) {
        continue;
      }
      
      const lastSent = rule.lastSent;
      const alreadySentToday = lastSent && format(lastSent, "yyyy-MM-dd") === todayStr;
      
      if (alreadySentToday) continue;

      let sentAny = false;

      if (rule.type === "recurrent") {
        if (rule.scheduleDay && now.getDate() === rule.scheduleDay) {
           console.log(`[Notification Sweeper] Disparando lembrete recorrente "${rule.title}"`);
           await sendPushToClients(rule.clientId, rule.title, rule.body);
           sentAny = true;
        }
      } else if (rule.type === "3_days_before" || rule.type === "on_due_date") {
        const targetDays = rule.type === "3_days_before" ? 3 : 0;
        
        let query;
        if (rule.clientId) {
          query = db
            .select()
            .from(documents)
            .where(eq(documents.clientId, rule.clientId));
        } else {
          query = db
            .select()
            .from(documents);
        }
        
        const docs = await query;
        for (const doc of docs) {
          if (doc.status === "paid" || !doc.dueDate) continue;
          
          const diff = getDaysDiff(doc.dueDate, now);
          if (diff === targetDays) {
            const dynamicBody = rule.body
              .replace(/\[NOME_GUIA\]/g, doc.title)
              .replace(/\[VENCIMENTO\]/g, doc.dueDate);
              
            const dynamicTitle = rule.title
              .replace(/\[NOME_GUIA\]/g, doc.title)
              .replace(/\[VENCIMENTO\]/g, doc.dueDate);

            console.log(`[Notification Sweeper] Enviando alerta para guia "${doc.title}" (vence em ${diff} dias)`);
            await sendPushToClients(doc.clientId, dynamicTitle, dynamicBody);
            sentAny = true;
          }
        }
      } else {
        // Para tipos não mapeados aqui
      }

      if (sentAny) {
         await db
           .update(scheduledNotifications)
           .set({ lastSent: now })
           .where(eq(scheduledNotifications.id, rule.id));
      } else if (rule.type !== "recurrent" || now.getDate() !== rule.scheduleDay) {
         // Para 3_days_before/on_due_date que não enviaram nada hoje, nós podemos
         // ou marcar como verificado hoje para não rodar de novo na próxima meia hora,
         // ou não marcar e deixar rodar depois. Se deixarmos rodar depois, 
         // se alguém enviar uma nova guia, ela pode ser pega! Isso é bom.
         // Porém, pra não imprimir o log toda hora, maybe it's fine.
      }
    }
  } catch (err) {
    console.error("[Notification Sweeper] Falha na execução da varredura:", err);
  }
}

// Executa a varredura a cada 30 minutos
setInterval(() => {
  runNotificationSweeper().catch(console.error);
}, 30 * 60 * 1000);

// Executa logo após a inicialização
setTimeout(() => {
  runNotificationSweeper().catch(console.error);
}, 10000);