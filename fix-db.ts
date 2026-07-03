import { db } from "./src/server/db";
import { documents } from "./src/server/schema";
import { eq } from "drizzle-orm";

async function run() {
  await db.update(documents).set({ status: "new" }).where(eq(documents.status, "waiting_accountant"));
  console.log("Fixed documents");
  process.exit(0);
}
run();
