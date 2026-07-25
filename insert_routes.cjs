const fs = require('fs');

const path = 'src/server/routes.ts';
let code = fs.readFileSync(path, 'utf8');

const routes = `
  app.get("/api/accountant/subscriptions", verifyAccountantAuth, async (req, res) => {
    try {
      const allClients = await db.select().from(clients);
      const subs = await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
      
      const enrichedSubs = subs.map(sub => {
        const client = allClients.find(c => c.id === sub.clientId);
        return {
          ...sub,
          client: client ? { id: client.id, name: client.name, cnpj: client.cnpj } : null
        };
      });

      res.json({ subscriptions: enrichedSubs });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/accountant/subscriptions/:id", verifyAccountantAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(subscriptions).where(eq(subscriptions.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
`;

const splitBy = '  app.delete(\n    "/api/admin/notifications/scheduled/:id",';
const parts = code.split(splitBy);
if (parts.length === 2) {
  code = parts[0] + routes + "\n" + splitBy + parts[1];
  fs.writeFileSync(path, code, 'utf8');
  console.log('Routes added successfully!');
} else {
  console.log('Failed to find the insertion point');
}
