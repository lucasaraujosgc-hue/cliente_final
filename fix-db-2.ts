import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { documents } from "./src/server/schema";
import { eq } from "drizzle-orm";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/applet"
});
const db = drizzle(pool);

async function run() {
  await db.update(documents).set({ status: "new" }).where(eq(documents.status, "waiting_accountant"));
  console.log("Fixed documents");
  process.exit(0);
}
run();
