/**
 * One-off maintenance script: re-hashes every client password that is still
 * stored in plaintext (legacy accounts created before the bcrypt migration).
 *
 * Safe to run multiple times — it only touches rows whose passwordHash
 * doesn't already look like a bcrypt hash, so already-migrated accounts
 * (including ones upgraded automatically on login) are left untouched.
 *
 * Usage:
 *   npm run migrate:passwords          # dry run, just reports what it would do
 *   npm run migrate:passwords -- --apply   # actually writes the new hashes
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { clients } from "../src/server/schema";
import { hashPassword } from "../src/server/services/password";

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

async function main() {
  const apply = process.argv.includes("--apply");

  const allClients = await db.select().from(clients);
  const legacy = allClients.filter(
    (c) => !BCRYPT_HASH_RE.test(String(c.passwordHash)),
  );

  if (legacy.length === 0) {
    console.log("Nenhuma conta com senha em texto puro encontrada. Nada a fazer.");
    await pool.end();
    return;
  }

  console.log(
    `Encontradas ${legacy.length} conta(s) com senha em texto puro (de ${allClients.length} no total).`,
  );

  if (!apply) {
    console.log("\nModo dry-run (nada foi alterado). Contas afetadas:");
    for (const c of legacy) {
      console.log(`  - ${c.name} (cnpj: ${c.cnpj})`);
    }
    console.log(
      "\nRode novamente com --apply para efetivamente migrar essas senhas:\n  npm run migrate:passwords -- --apply",
    );
    await pool.end();
    return;
  }

  let migrated = 0;
  for (const c of legacy) {
    const newHash = await hashPassword(String(c.passwordHash));
    await db.update(clients).set({ passwordHash: newHash }).where(eq(clients.id, c.id));
    migrated++;
    console.log(`  ✓ ${c.name} (cnpj: ${c.cnpj})`);
  }

  console.log(`\n${migrated} conta(s) migrada(s) para bcrypt com sucesso.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Erro ao migrar senhas:", err);
  process.exit(1);
});
