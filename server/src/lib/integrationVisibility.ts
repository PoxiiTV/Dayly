import type { IntegrationDisplay } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getGooglePlatformConfig, getTelegramPlatformSettings, getWhatsAppPlatformConfig } from "./integrationSettings.js";

/** Integrations an admin can hide or announce while they are not ready. */
export const INTEGRATION_KEYS = ["telegram", "whatsapp", "gmailGoogle"] as const;
export type IntegrationKey = typeof INTEGRATION_KEYS[number];
export type IntegrationState = "AVAILABLE" | IntegrationDisplay;

const DEFAULT_DISPLAY: IntegrationDisplay = "COMING_SOON";

export async function getIntegrationDisplaySettings(): Promise<Record<IntegrationKey, IntegrationDisplay>> {
  const rows = await prisma.integrationVisibility.findMany({ where: { key: { in: [...INTEGRATION_KEYS] } } });
  const byKey = new Map(rows.map((row) => [row.key, row.whenUnavailable]));
  return Object.fromEntries(INTEGRATION_KEYS.map((key) => [key, byKey.get(key) ?? DEFAULT_DISPLAY])) as Record<IntegrationKey, IntegrationDisplay>;
}

export async function saveIntegrationDisplaySettings(input: Partial<Record<IntegrationKey, IntegrationDisplay>>) {
  for (const key of INTEGRATION_KEYS) {
    const value = input[key];
    if (!value) continue;
    await prisma.integrationVisibility.upsert({ where: { key }, create: { key, whenUnavailable: value }, update: { whenUnavailable: value } });
  }
  return getIntegrationDisplaySettings();
}

/**
 * What each user should see: AVAILABLE once the admin enabled and configured
 * it, otherwise the admin's choice between hiding it and "Próximamente".
 */
export async function getIntegrationStates(): Promise<Record<IntegrationKey, IntegrationState>> {
  const [display, telegram, whatsapp, google] = await Promise.all([
    getIntegrationDisplaySettings(),
    getTelegramPlatformSettings(),
    getWhatsAppPlatformConfig(),
    getGooglePlatformConfig(),
  ]);
  const available: Record<IntegrationKey, boolean> = {
    telegram: telegram.enabled,
    whatsapp: whatsapp.available,
    gmailGoogle: google.available,
  };
  return Object.fromEntries(INTEGRATION_KEYS.map((key) => [key, available[key] ? "AVAILABLE" : display[key]])) as Record<IntegrationKey, IntegrationState>;
}
