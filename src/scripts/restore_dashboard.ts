import { execSync } from "child_process";

try {
  execSync("git checkout -- src/pages/client/Dashboard.tsx");
  console.log("Successfully restored Dashboard.tsx from git!");
} catch (error: any) {
  console.error("Failed to restore:", error.message);
}
