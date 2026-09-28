import { decryptSecret } from "../src/lib/crypto.js";
import { bootstrapIntegrationSettings } from "../src/lib/integrationSettings.js";
import { prisma } from "../src/lib/prisma.js";
import { saveUserTelegramBot } from "../src/lib/telegram.js";

function argument(name: string): string {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? "").trim() : "";
}

async function main() {
  const ownerEmail = (argument("telegram-owner-email") || process.env.TELEGRAM_LEGACY_OWNER_EMAIL || "").trim().toLowerCase();
  if (!ownerEmail) throw new Error("Indica --telegram-owner-email con el administrador que asumirá el bot heredado.");

  await bootstrapIntegrationSettings();
  const owner = await prisma.user.findUnique({ where: { emailLower: ownerEmail }, include: { role: { select: { name: true } } } });
  if (!owner || owner.role.name !== "ADMIN") throw new Error("El propietario indicado no existe o no es administrador.");

  const legacy = await prisma.telegramSetting.findUnique({ where: { id: 1 } });
  if (!legacy?.botTokenEnc) {
    console.log("No hay un bot heredado pendiente de migrar.");
    return;
  }

  const ownerLink = await prisma.telegramLink.findFirst({ where: { botId: null, userId: owner.id, revokedAt: null }, orderBy: { linkedAt: "desc" } });
  const bot = await saveUserTelegramBot(owner.id, decryptSecret(legacy.botTokenEnc));
  await prisma.$transaction(async (tx) => {
    await tx.telegramLink.updateMany({
      where: { botId: null, userId: { not: owner.id }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (ownerLink) await tx.telegramLink.update({ where: { id: ownerLink.id }, data: { botId: bot.id, revokedAt: null } });
    await tx.telegramSetting.update({ where: { id: 1 }, data: { botUsername: bot.username } });
  });

  console.log(`Bot heredado asignado a su administrador como ${bot.username ? `@${bot.username}` : "bot validado"}. Falta activar el webhook desde Ajustes.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "No se pudo migrar el bot heredado.");
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
