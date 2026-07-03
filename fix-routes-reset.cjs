const fs = require('fs');
let code = fs.readFileSync('src/server/routes.ts', 'utf8');

const resetEndpoint = `
  app.post(
    "/api/accountant/client/:id/reset-password",
    verifyAccountantAuth,
    async (req, res) => {
      try {
        const { id } = req.params;
        const clientList = await db.select().from(clients).where(eq(clients.id, id));
        if (clientList.length === 0) {
          return res.status(404).json({ error: "Cliente não encontrado" });
        }
        
        const client = clientList[0];
        const cleanCnpj = client.cnpj.replace(/\\D/g, "");
        
        await db.update(clients)
          .set({ 
             passwordHash: cleanCnpj,
             firstAccessDone: false
          })
          .where(eq(clients.id, id));
          
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ error: e.message });
      }
    }
  );
`;

code = code.replace('  app.put(\n    "/api/accountant/client/:id",', resetEndpoint + '\n  app.put(\n    "/api/accountant/client/:id",');
fs.writeFileSync('src/server/routes.ts', code);
