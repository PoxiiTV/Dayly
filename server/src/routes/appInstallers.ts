import { existsSync } from "node:fs";
import { Router } from "express";
import { config } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { SHELL_VERSION } from "../lib/brand.js";
import {
  INSTALLER_FILES,
  installerPath,
  listInstallers,
  parseInstallerPlatform,
  windowsUpdaterSignature,
} from "../lib/installers.js";

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

function compareVersions(left: string, right: string): number | null {
  const a = VERSION_RE.exec(left.trim());
  const b = VERSION_RE.exec(right.trim());
  if (!a || !b) return null;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

/** Public metadata is safe because every artifact is verified with the key embedded in the app. */
export const appUpdaterRouter = Router();

appUpdaterRouter.get("/download/windows/:version", asyncHandler(async (req, res) => {
  if (req.params.version !== SHELL_VERSION) throw ApiError.notFound("Actualización no disponible.");
  const abs = installerPath("windows");
  if (!existsSync(abs) || !await windowsUpdaterSignature()) throw ApiError.notFound("Actualización no disponible.");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.download(abs, `Dayly-Setup-${SHELL_VERSION}.exe`);
}));

appUpdaterRouter.get("/:target/:arch/:currentVersion", asyncHandler(async (req, res) => {
  const comparison = compareVersions(SHELL_VERSION, req.params.currentVersion);
  if (req.params.target !== "windows" || req.params.arch !== "x86_64" || comparison === null || comparison <= 0) {
    res.status(204).end();
    return;
  }
  const abs = installerPath("windows");
  const signature = await windowsUpdaterSignature();
  if (!existsSync(abs) || !signature) {
    res.status(204).end();
    return;
  }
  res.setHeader("Cache-Control", "public, no-store");
  res.json({
    version: SHELL_VERSION,
    url: new URL(`/api/app/updater/download/windows/${SHELL_VERSION}`, config.publicUrl).toString(),
    signature,
    notes: "Actualización de Dayly para Windows.",
  });
}));

export const appInstallersRouter = Router();
appInstallersRouter.use(requireAuth);

appInstallersRouter.get("/", asyncHandler(async (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await listInstallers());
}));

appInstallersRouter.get("/:platform", asyncHandler(async (req, res) => {
  const platform = parseInstallerPlatform(req.params.platform);
  if (!platform) throw ApiError.notFound("Instalador no disponible.");
  const abs = installerPath(platform);
  if (!existsSync(abs)) throw ApiError.notFound("Instalador no disponible.");
  res.setHeader("Cache-Control", "private, no-store");
  res.download(abs, INSTALLER_FILES[platform].downloadName);
}));
