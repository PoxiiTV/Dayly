import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import path from "node:path";

// Load repo .env for tests (cwd = server/ when vitest runs).
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: true });
// Tests seed and wipe data: never let them reach the .env database when a test one is given.
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
    pool: "forks",
  },
});