#!/usr/bin/env node
/**
 * Migra una base de datos del Dayly original (1.x) a Dayly 2.0 sin perder datos,
 * y en cualquier otra base simplemente aplica las migraciones pendientes.
 *
 *   node scripts/migrar-desde-dayly.mjs
 *
 * Usa DATABASE_URL y APP_SECRET del entorno o, si faltan, del .env de la raíz
 * (el APP_SECRET debe ser el mismo con el que se cifraron los datos).
 * Es idempotente: se puede volver a lanzar si se corta a medias.
 *
 * Pasos en una base legacy:
 *  1. Guarda ciudad y bot de Telegram de cada usuario en `_dayly_legacy`.
 *  2. Adapta lo que 2.0 hace distinto (tipo BRIEFING, clave de fútbol) y olvida
 *     las migraciones del 1.x que 2.0 sustituye por las suyas.
 *  3. prisma migrate deploy.
 *  4. Pasa ciudad → weatherCity y el bot al modelo TelegramBot/TelegramLink,
 *     y borra las columnas y la tabla temporales.
 */
import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(path.join(root, ".env"))) dotenv.config({ path: path.join(root, ".env") });
if (!process.env.DATABASE_URL) fail("Falta DATABASE_URL (entorno o .env).");

const LEGACY_MARK = "20260826160000_user_city";
// Migraciones del 1.x que 2.0 no trae: su efecto se adapta aquí.
const LEGACY_ONLY = [
  "20260826090000_mascot_drop_football_key",
  "20260826140000_user_telegram_bot",
  "20260826150000_notification_briefing_type",
  LEGACY_MARK,
];

const db = new PrismaClient();
const log = (msg) => console.log(`· ${msg}`);

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

// Mismo cifrado que server/src/lib/crypto.ts (AES-256-GCM con subclave HMAC del APP_SECRET).
function fieldKey() {
  if (!process.env.APP_SECRET) throw new Error("Falta APP_SECRET");
  return createHmac("sha256", process.env.APP_SECRET).update("dayly:field-encryption").digest().subarray(0, 32);
}
function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fieldKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
function decryptSecret(payload) {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", fieldKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

async function tableExists(name) {
  const rows = await db.$queryRaw`SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${name}`;
  return rows.length > 0;
}
async function columnExists(table, column) {
  const rows = await db.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ${table} AND column_name = ${column}`;
  return rows.length > 0;
}

async function prepareLegacy() {
  log("Base del Dayly original detectada. Preparando la migración…");
  if (!(await tableExists("_dayly_legacy"))) {
    await db.$executeRawUnsafe(
      "CREATE TABLE `_dayly_legacy` AS SELECT `id`, `city`, `telegramBotTokenEnc`, `telegramChatId` FROM `User`",
    );
    log("Ciudad y bot de Telegram de cada usuario guardados aparte.");
  }
  // 2.0 redefine el enum sin BRIEFING antes de volver a añadirlo: que no quede ninguna fila fuera.
  const retyped = await db.$executeRawUnsafe("UPDATE `Notification` SET `type` = 'SYSTEM' WHERE `type` = 'BRIEFING'");
  if (retyped) log(`${retyped} avisos de resumen matinal pasados a tipo sistema.`);
  if (!(await columnExists("User", "mascotFootballKeyEnc"))) {
    await db.$executeRawUnsafe("ALTER TABLE `User` ADD COLUMN `mascotFootballKeyEnc` TEXT NULL");
    log("Columna de la clave de fútbol restaurada.");
  }
  await db.$executeRawUnsafe(
    `DELETE FROM \`_prisma_migrations\` WHERE \`migration_name\` IN (${LEGACY_ONLY.map(() => "?").join(", ")})`,
    ...LEGACY_ONLY,
  );
}

async function migrateTelegram(row) {
  if (!row.telegramBotTokenEnc) return;
  if (await db.$queryRaw`SELECT 1 FROM TelegramBot WHERE userId = ${row.id} LIMIT 1`.then((r) => r.length)) return;
  let token;
  try {
    token = decryptSecret(row.telegramBotTokenEnc);
  } catch {
    log(`Usuario ${row.id}: su token de Telegram no se puede descifrar con este APP_SECRET; tendrá que volver a pegarlo en Ajustes › Integraciones.`);
    return;
  }
  const telegramBotId = token.split(":")[0];
  if (!/^\d{5,20}$/.test(telegramBotId)) return;
  if (await db.$queryRaw`SELECT 1 FROM TelegramBot WHERE telegramBotId = ${telegramBotId} LIMIT 1`.then((r) => r.length)) return;
  const routingToken = randomBytes(24).toString("base64url");
  const botId = randomUUID();
  await db.$executeRaw`
    INSERT INTO TelegramBot (id, userId, telegramBotId, tokenEnc, routingTokenHash, routingTokenEnc, webhookSecretEnc, status, createdAt, updatedAt)
    VALUES (${botId}, ${row.id}, ${telegramBotId}, ${encryptSecret(token)}, ${createHash("sha256").update(routingToken).digest("hex")},
            ${encryptSecret(routingToken)}, ${encryptSecret(randomBytes(24).toString("base64url"))}, 'PENDING', NOW(3), NOW(3))`;
  if (row.telegramChatId) {
    await db.$executeRaw`
      INSERT INTO TelegramLink (id, userId, botId, chatId, linkedAt)
      VALUES (${randomUUID()}, ${row.id}, ${botId}, ${String(row.telegramChatId).slice(0, 32)}, NOW(3))`;
  }
  log(`Usuario ${row.id}: bot de Telegram trasladado${row.telegramChatId ? " con su chat" : ""}. Falta pulsar «Activar» en Ajustes › Integraciones.`);
  return true;
}

async function finishLegacy() {
  const rows = await db.$queryRawUnsafe("SELECT `id`, `city`, `telegramBotTokenEnc`, `telegramChatId` FROM `_dayly_legacy`");
  const cities = await db.$executeRawUnsafe(
    "UPDATE `User` u JOIN `_dayly_legacy` l ON l.`id` = u.`id` SET u.`weatherCity` = l.`city` WHERE u.`weatherCity` IS NULL AND l.`city` IS NOT NULL AND l.`city` <> ''",
  );
  if (cities) log(`${cities} ciudades pasadas a «Ciudad para el clima».`);
  let bots = 0;
  for (const row of rows) if (await migrateTelegram(row)) bots += 1;
  if (bots) {
    // En 1.x Telegram ya funcionaba: que 2.0 no lo esconda tras «Próximamente».
    await db.$executeRawUnsafe(
      "INSERT INTO `TelegramSetting` (`id`, `enabled`, `importedFromEnvAt`, `updatedAt`) VALUES (1, true, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE `enabled` = true",
    );
    log("Telegram queda habilitado para todos, como en el Dayly original.");
  }
  for (const column of ["city", "telegramBotTokenEnc", "telegramChatId"]) {
    if (await columnExists("User", column)) await db.$executeRawUnsafe(`ALTER TABLE \`User\` DROP COLUMN \`${column}\``);
  }
  // El 1.x aplicó la migración inicial con un charset erróneo: el título por defecto de las notas quedó como «Sin tÃ­tulo».
  await db.$executeRawUnsafe("ALTER TABLE `Note` MODIFY `title` VARCHAR(300) NOT NULL DEFAULT 'Sin título'");
  const titles = await db.$executeRawUnsafe("UPDATE `Note` SET `title` = 'Sin título' WHERE `title` = 'Sin tÃ­tulo'");
  if (titles) log(`${titles} notas con el título por defecto corregido.`);
  await db.$executeRawUnsafe("DROP TABLE `_dayly_legacy`");
  log("Columnas antiguas retiradas.");
}

async function main() {
  const legacy = (await tableExists("_prisma_migrations"))
    && (await db.$queryRaw`SELECT 1 FROM _prisma_migrations WHERE migration_name = ${LEGACY_MARK}`).length > 0;
  if (legacy) await prepareLegacy();

  log("Aplicando migraciones de Dayly 2.0…");
  const deploy = spawnSync("npx prisma migrate deploy --schema server/prisma/schema.prisma", { cwd: root, stdio: "inherit", shell: true });
  if (deploy.status !== 0) fail("prisma migrate deploy falló. Corrige el error de arriba y vuelve a lanzar este script: es seguro repetirlo.");

  if (await tableExists("_dayly_legacy")) await finishLegacy();
  console.log("✔ Base de datos lista para Dayly 2.0.");
}

main()
  .catch((err) => fail(err instanceof Error ? err.message : String(err)))
  .finally(() => db.$disconnect());
