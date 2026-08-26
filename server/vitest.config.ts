import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import path from "node:path";

// Load repo .env for tests (cwd = server/ when vitest runs).
// An explicit DATABASE_URL in the environment wins: tests then run against
// that scratch database instead of the dev one.
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: !process.env.DATABASE_URL });
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