const fs = require('fs');
let code = fs.readFileSync('src/server/routes.ts', 'utf8');

const toReplace = `
        const targetClient = clientList[0];

        // Create document
        const [newDoc] = await db
          .insert(documents)
          .values({
            clientId: targetClient.id,
            title: nomeArquivo,
            category: categoria,
            dueDate: dataVencimento || null,
            status: "new",
            uploadedBy: "accountant",
            fileUrl: arquivoBase64,
          })
          .returning();
`;

const replacement = `
        const targetClient = clientList[0];

        let finalFileUrl = null;
        if (arquivoBase64) {
           const match = arquivoBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
           if (match) {
              const buffer = Buffer.from(match[2], 'base64');
              const safeFilename = \`\${Date.now()}_\${nomeArquivo || "documento.pdf"}\`;
              const filePath = path.join(UPLOADS_DIR, safeFilename);
              fs.writeFileSync(filePath, buffer);
              finalFileUrl = \`/uploads/\${safeFilename}\`;
           }
        }

        // Create document
        const [newDoc] = await db
          .insert(documents)
          .values({
            clientId: targetClient.id,
            title: nomeArquivo,
            category: categoria,
            dueDate: dataVencimento || null,
            status: "new",
            uploadedBy: "accountant",
            fileUrl: finalFileUrl,
          })
          .returning();
`;

code = code.replace(toReplace, replacement);
fs.writeFileSync('src/server/routes.ts', code);
