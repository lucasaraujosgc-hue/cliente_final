/**
 * Local-dev demo data. Never runs automatically and refuses to touch a
 * non-empty database. Run after `npm run db:migrate`:
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { pool } from "../src/server/db";
import { hashPassword } from "../src/server/services/password";

// CNPJ is stored digits-only. Login with "12345678000199" (or any punctuation).
const DEMO = [
  { id: "c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb101", cnpj: "12345678000199", name: "Empresa XPTO Ltda", status: "warning" },
  { id: "c8f4b0ab-2b7e-4628-98e3-0d5b5b0eb102", cnpj: "98765432000111", name: "Startup Inovadora S/A", status: "green" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM clients`);
  if (rows[0].n > 0) {
    console.log(`[seed] clients table already has ${rows[0].n} row(s) — nothing to do.`);
    await pool.end();
    return;
  }

  for (const c of DEMO) {
    // Demo password = the client's own CNPJ (matches first-access instructions).
    await pool.query(
      `INSERT INTO clients (id, cnpj, name, password_hash, regularity_status, first_access_done)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [c.id, c.cnpj, c.name, await hashPassword(c.cnpj), c.status],
    );
  }

  await pool.query(
    `INSERT INTO documents (client_id, title, category, due_date, status, uploaded_by) VALUES
     ($1, 'Guia DAS (Simples Nacional)', 'taxes', '2026-06-20', 'pending', 'accountant'),
     ($1, 'Contrato Social v2', 'company', NULL, 'viewed', 'accountant')`,
    [DEMO[0].id],
  );

  await pool.query(
    `INSERT INTO billing_data (client_id, month, revenue, expenses, payroll) VALUES
     ($1,'2026-01',50000,15000,20000),
     ($1,'2026-02',55000,14000,20000),
     ($1,'2026-03',48000,16000,20000),
     ($1,'2026-04',60000,15000,22000),
     ($1,'2026-05',65000,18000,22000)`,
    [DEMO[0].id],
  );

  await pool.query(
    `INSERT INTO messages (client_id, content, read)
     VALUES ($1, 'Lembrete: fechamento da folha até dia 05, enviar recibos pendentes.', false)`,
    [DEMO[0].id],
  );

  console.log("[seed] demo clients created.");
  await pool.end();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
