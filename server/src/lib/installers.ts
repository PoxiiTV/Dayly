import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { downloadsDir } from "../config/env.js";
import { SHELL_VERSION } from "./brand.js";

export const INSTALLER_FILES = {
  windows: { diskName: "kalendiario-windows.exe", downloadName: "Kalendiario-Setup.exe" },
  android: { diskName: "kalendiario.apk", downloadName: "Kalendiario.apk" },
} as const;

export const WINDOWS_UPDATER_SIGNATURE_FILE = "kalendiario-windows.exe.sig";

export type InstallerPlatform = keyof typeof INSTALLER_FILES;

export type InstallerMeta = { url: string; size: number; sha256: string };

export type InstallersResponse = {
  shellVersion: string;
  windows: InstallerMeta | null;
  android: InstallerMeta | null;
};

export function parseInstallerPlatform(raw: string | undefined): InstallerPlatform | null {
  if (raw === "windows" || raw === "android") return raw;
  return null;
}

export function installerPath(platform: InstallerPlatform): string {
  return path.join(downloadsDir(), INSTALLER_FILES[platform].diskName);
}

export function windowsUpdaterSignaturePath(): string {
  return path.join(downloadsDir(), WINDOWS_UPDATER_SIGNATURE_FILE);
}

export async function windowsUpdaterSignature(): Promise<string | null> {
  const abs = windowsUpdaterSignaturePath();
  if (!existsSync(abs)) return null;
  const signature = (await readFile(abs, "utf8")).trim();
  return signature || null;
}

export async function installerMeta(platform: InstallerPlatform): Promise<InstallerMeta | null> {
  const abs = installerPath(platform);
  if (!existsSync(abs)) return null;
  const size = (await stat(abs)).size;
  if (!Number.isFinite(size) || size <= 0) return null;
  return {
    url: `/api/app/installers/${platform}`,
    size,
    sha256: await hashFile(abs),
  };
}

export async function listInstallers(): Promise<InstallersResponse> {
  const [windows, android] = await Promise.all([
    installerMeta("windows"),
    installerMeta("android"),
  ]);
  return { shellVersion: SHELL_VERSION, windows, android };
}

function hashFile(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(abs);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
