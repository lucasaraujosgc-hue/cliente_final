const fs = require('fs');
let code = fs.readFileSync('src/server/routes.ts', 'utf8');

const toReplace = `
        try {
          const config = await db.select().from(serproConfig).where(eq(serproConfig.usuarioId, 1)).limit(1);
          const multipleFilesText = config[0]?.multipleFilesText || "Vários arquivos recebidos";
          const rules = await db.select().from(scheduledNotifications)
            .where(eq(scheduledNotifications.type, 'on_file_available'));
          
          for (const rule of rules) {
            if (!rule.clientId || rule.clientId === clientId) {
              let title = rule.title || "Nova Guia Disponível";
              let body = rule.body || "";
              if (docs.length === 1) {
                const doc = docs[0];
                title = title.replace(/\\[NOME_GUIA\\]/g, doc.title || "").replace(/\\[CATEGORIA\\]/g, doc.category || "");
                body = body.replace(/\\[NOME_GUIA\\]/g, doc.title || "")
                           .replace(/\\[CATEGORIA\\]/g, doc.category || "")
                           .replace(/\\[VENCIMENTO\\]/g, doc.dueDate || "N/A");
              } else {
                title = \`Novos Documentos Recebidos (\${docs.length})\`;
                let docsList = docs.map((d: any) => \`- \${d.title || "Documento"}\`).join('\\\\n');
                body = body.replace(/\\[NOME_GUIA\\]/g, \`\${multipleFilesText}:\\\\n\${docsList}\`)
                           .replace(/\\[CATEGORIA\\]/g, "Múltiplas Categorias")
                           .replace(/\\[VENCIMENTO\\]/g, "Verificar no sistema");
              }
              
              await sendClientNotification(clientId, title, body);
            }
          }
        } catch(e) {`;

const replacement = `
        try {
          if (docs.length === 1) {
            const rules = await db.select().from(scheduledNotifications)
              .where(eq(scheduledNotifications.type, 'on_file_available'));
            const doc = docs[0];
            for (const rule of rules) {
              if (!rule.clientId || rule.clientId === clientId) {
                let title = (rule.title || "Nova Guia Disponível")
                            .replace(/\\[NOME_GUIA\\]/g, doc.title || "")
                            .replace(/\\[CATEGORIA\\]/g, doc.category || "");
                let body = (rule.body || "")
                           .replace(/\\[NOME_GUIA\\]/g, doc.title || "")
                           .replace(/\\[CATEGORIA\\]/g, doc.category || "")
                           .replace(/\\[VENCIMENTO\\]/g, doc.dueDate || "N/A");
                await sendClientNotification(clientId, title, body);
              }
            }
          } else {
            const multiRules = await db.select().from(scheduledNotifications)
              .where(eq(scheduledNotifications.type, 'on_multiple_files_available'));
            let docsList = docs.map((d: any) => \`- \${d.title || "Documento"}\`).join('\\\\n');
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
        } catch(e) {`;

code = code.replace(toReplace, replacement);
fs.writeFileSync('src/server/routes.ts', code);
