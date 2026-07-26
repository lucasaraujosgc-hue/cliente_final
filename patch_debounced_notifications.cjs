const fs = require('fs');
const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

// 1. Add the triggerDebouncedDocumentNotification function after webhookNotificationDocs
const functionDefinition = `
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
                        .replace(/\\[NOME_GUIA\\]/g, docObj.category || "")
                        .replace(/\\[CATEGORIA\\]/g, docObj.category || "");
            let body = (rule.body || "")
                       .replace(/\\[NOME_GUIA\\]/g, docObj.category || "")
                       .replace(/\\[CATEGORIA\\]/g, docObj.category || "")
                       .replace(/\\[VENCIMENTO\\]/g, docObj.dueDate || "N/A");
            await sendClientNotification(clientId, title, body);
          }
        }
      } else {
        const multiRules = await db.select().from(scheduledNotifications)
          .where(eq(scheduledNotifications.type, 'on_multiple_files_available'));
        let docsList = docs.map((d: any) => \`- \${d.category || "Documento"}\`).join('\\n');
        for (const rule of multiRules) {
          if (!rule.clientId || rule.clientId === clientId) {
            let title = (rule.title || \`Novos Documentos Recebidos (\${docs.length})\`)
                        .replace(/\\[CATEGORIA\\]/g, "Múltiplas Categorias")
                        .replace(/\\[NOME_GUIA\\]/g, "Vários arquivos")
                        .replace(/\\[VENCIMENTO\\]/g, "Diversos")
                        .replace(/\\[LISTA_GUIAS\\]/g, docsList);
            let body = (rule.body || "")
                       .replace(/\\[CATEGORIA\\]/g, "Múltiplas Categorias")
                       .replace(/\\[NOME_GUIA\\]/g, "Vários arquivos")
                       .replace(/\\[VENCIMENTO\\]/g, "Diversos")
                       .replace(/\\[LISTA_GUIAS\\]/g, docsList);
            await sendClientNotification(clientId, title, body);
          }
        }
      }
    } catch(e) {
      console.error("Error in debounced notification", e);
    }
  }, 30000); // 30 seconds debounce
}
`;

const targetAnchor = `const webhookNotificationDocs: Record<string, any[]> = {};`;
if (code.includes(targetAnchor) && !code.includes('export function triggerDebouncedDocumentNotification')) {
  code = code.replace(targetAnchor, targetAnchor + functionDefinition);
}

// 2. Replace logic in webhook
const webhookTarget = `      // Trigger on_file_available notification logic here for this document (with debounce)
      const clientId = newDoc[0].clientId;
      if (!webhookNotificationDocs[clientId]) {
        webhookNotificationDocs[clientId] = [];
      }
      webhookNotificationDocs[clientId].push(newDoc[0]);

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
            const doc = docs[0];
            for (const rule of rules) {
              if (!rule.clientId || rule.clientId === clientId) {
                let title = (rule.title || "Nova Guia Disponível")
                            .replace(/\\[NOME_GUIA\\]/g, doc.category || "")
                            .replace(/\\[CATEGORIA\\]/g, doc.category || "");
                let body = (rule.body || "")
                           .replace(/\\[NOME_GUIA\\]/g, doc.category || "")
                           .replace(/\\[CATEGORIA\\]/g, doc.category || "")
                           .replace(/\\[VENCIMENTO\\]/g, doc.dueDate || "N/A");
                await sendClientNotification(clientId, title, body);
              }
            }
          } else {
            const multiRules = await db.select().from(scheduledNotifications)
              .where(eq(scheduledNotifications.type, 'on_multiple_files_available'));
            let docsList = docs.map((d: any) => \`- \${d.category || "Documento"}\`).join('\\n');
            for (const rule of multiRules) {
              if (!rule.clientId || rule.clientId === clientId) {
                let title = (rule.title || \`Novos Documentos Recebidos (\${docs.length})\`)
                            .replace(/\\[CATEGORIA\\]/g, "Múltiplas Categorias")
                            .replace(/\\[NOME_GUIA\\]/g, "Vários arquivos")
                            .replace(/\\[VENCIMENTO\\]/g, "Diversos")
                            .replace(/\\[LISTA_GUIAS\\]/g, docsList);
                let body = (rule.body || "")
                           .replace(/\\[CATEGORIA\\]/g, "Múltiplas Categorias")
                           .replace(/\\[NOME_GUIA\\]/g, "Vários arquivos")
                           .replace(/\\[VENCIMENTO\\]/g, "Diversos")
                           .replace(/\\[LISTA_GUIAS\\]/g, docsList);
                await sendClientNotification(clientId, title, body);
              }
            }
          }
        } catch(e) {
          console.error("Error in webhook debounced notification", e);
        }
      }, 30000); // 30 seconds debounce`;

const webhookReplacement = `      // Trigger debounced notification
      triggerDebouncedDocumentNotification(newDoc[0]);`;

if (code.includes(webhookTarget)) {
  code = code.replace(webhookTarget, webhookReplacement);
}

// 3. Replace logic in /api/accountant/solicitacoes/:id
const solicitacoesTarget = `        // Trigger on_file_available notification logic here for this document
        const rules = await db.select().from(scheduledNotifications)
          .where(eq(scheduledNotifications.type, 'on_file_available'));
        
        for (const rule of rules) {
          if (!rule.clientId || rule.clientId === doc.clientId) {
            let title = (rule.title || "Nova Guia Disponível").replace(/\\[NOME_GUIA\\]/g, doc.category).replace(/\\[CATEGORIA\\]/g, doc.category);
            let body = (rule.body || "").replace(/\\[NOME_GUIA\\]/g, doc.category)
                                         .replace(/\\[CATEGORIA\\]/g, doc.category)
                                         .replace(/\\[VENCIMENTO\\]/g, updatedDoc.dueDate || "N/A");
            
            await sendClientNotification(doc.clientId, title, body);
          }
        }`;

const solicitacoesReplacement = `        // Trigger debounced notification
        triggerDebouncedDocumentNotification(updatedDoc);`;

if (code.includes(solicitacoesTarget)) {
  code = code.replace(solicitacoesTarget, solicitacoesReplacement);
}

fs.writeFileSync(path, code, 'utf8');
console.log('Successfully patched routes with reusable debounce function.');
