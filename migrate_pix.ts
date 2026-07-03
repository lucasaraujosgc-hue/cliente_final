import { db } from "./src/server/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`ALTER TABLE documents ADD COLUMN pix_code TEXT;`);
  console.log("Migration done");
  process.exit(0);
}
main().catch(console.error);
