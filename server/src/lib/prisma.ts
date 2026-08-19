import { PrismaClient } from "@prisma/client";
import { config } from "../config/env.js";

/**
 * Single shared Prisma client. In production reuse is critical for connection
 * pooling; in dev we keep one instance across hot-reloads via globalThis.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
    log:
      config.nodeEnv === "development"
        ? [{ emit: "event", level: "query" }, { emit: "event", level: "warn" }]
        : ["error", "warn"],
  });

if (config.nodeEnv !== "production") globalForPrisma.prisma = prisma;