/**
 * dotenv bootstrap. Runs first: loads ../.env (repo root) so config/env.ts
 * sees real values even when not launched via the npm --env-file scripts
 * (e.g. tsx in editors). Resolutions are relative to this file's dir.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** server/src or server/dist → repo root is three levels up from src. */
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const envPath = path.join(repoRoot, ".env");
const loaded = dotenv.config({ path: envPath });
// Plesk/Passenger often injects SMTP_HOST="" from an old panel snapshot.
// dotenv skips keys that already exist, even if they are empty — fill those in.
if (loaded.parsed) {
  for (const [key, value] of Object.entries(loaded.parsed)) {
    if (process.env[key] === "") process.env[key] = value;
  }
}