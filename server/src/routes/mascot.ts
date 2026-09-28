import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { AUTO_FREE_OPTION, fetchCustomCatalog, fetchOpenRouterCatalog, listOpencodeModels, loadOpenCodeCatalogs, parsePublicHttpsUrl, resolveChatTarget, type MascotProvider, type OpenCodeLane } from "../lib/mascot/catalog.js";
import { asMascotProvider, hydrateKeyVault, keyEncFor, publicKeyStatus, serializeKeyVault } from "../lib/mascot/keys.js";
import { pingFootballKey } from "../lib/mascot/football.js";
import { completeChat } from "../lib/mascot/client.js";
import { MASCOT_TOOLS } from "../lib/mascot/tools.js";
import { asMascotId, MASCOT_IDS } from "../lib/mascot/characters.js";
import { mascotSystemPrompt, runMascotTurn } from "../lib/mascot/chat.js";

export const mascotRouter = Router();
mascotRouter.use(requireAuth);

const providerZ = z.enum(["opencode", "openrouter", "custom"]);

const patchSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  character: z.enum(MASCOT_IDS).optional(),
  provider: providerZ.optional(),
  model: z.string().trim().min(1).max(80).optional(),
  /** Model for the task assistants; empty or null follows the mascot's. */
  taskModel: z.string().trim().max(80).nullish(),
  baseUrl: z.string().trim().max(300).nullish(),
  modelsUrl: z.string().trim().max(300).nullish(),
  usageUrl: z.string().trim().max(300).nullish(),
  apiKey: z.string().trim().min(8).max(400).optional(),
  clearKey: z.boolean().optional(),
  footballApiKey: z.string().trim().min(8).max(80).optional(),
  clearFootballKey: z.boolean().optional(),
});

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })).min(1).max(24),
  stream: z.boolean().optional(),
  /** Stable OpenCode conversation id (`x-opencode-session`). */
  sessionId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
  messagingContext: z.object({
    conversationId: z.string().trim().min(1).max(191),
    selectedMessageIds: z.array(z.string().trim().min(1).max(191)).min(1).max(10),
    recentCount: z.number().int().min(0).max(10).optional(),
    dataProcessingConfirmed: z.literal(true),
  }).optional(),
});

function publicSettings(u: {
  mascotEnabled: boolean;
  mascotCharacter: string;
  mascotProvider: string;
  mascotModel: string;
  aiTaskModel: string | null;
  mascotBaseUrl: string | null;
  mascotModelsUrl: string | null;
  mascotUsageUrl: string | null;
  mascotApiKeyEnc: string | null;
  mascotApiKeysEnc: string | null;
  mascotFootballKeyEnc: string | null;
}) {
  const provider = asMascotProvider(u.mascotProvider);
  const vault = hydrateKeyVault(u.mascotApiKeysEnc, u.mascotApiKeyEnc, u.mascotProvider);
  const keys = publicKeyStatus(vault);
  const current = keys[provider];
  return {
    enabled: u.mascotEnabled,
    character: asMascotId(u.mascotCharacter),
    provider: u.mascotProvider,
    model: u.mascotModel,
    taskModel: u.aiTaskModel,
    baseUrl: u.mascotBaseUrl,
    modelsUrl: u.mascotModelsUrl,
    usageUrl: u.mascotUsageUrl,
    hasKey: current.hasKey,
    keyValid: current.valid,
    keys,
    hasFootballKey: Boolean(u.mascotFootballKeyEnc),
  };
}

const SETTINGS_SELECT = {
  mascotEnabled: true,
  mascotCharacter: true,
  mascotProvider: true,
  mascotModel: true,
  aiTaskModel: true,
  mascotBaseUrl: true,
  mascotModelsUrl: true,
  mascotUsageUrl: true,
  mascotApiKeyEnc: true,
  mascotApiKeysEnc: true,
  mascotFootballKeyEnc: true,
} as const;

mascotRouter.get("/settings", asyncHandler(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: SETTINGS_SELECT,
  });
  res.json({ settings: publicSettings(u) });
}));

mascotRouter.patch("/settings", validate(patchSettingsSchema), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof patchSettingsSchema>;
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: SETTINGS_SELECT,
  });
  const nextProvider = b.provider !== undefined ? asMascotProvider(b.provider) : asMascotProvider(current.mascotProvider);
  const vault = hydrateKeyVault(current.mascotApiKeysEnc, current.mascotApiKeyEnc, current.mascotProvider);
  const data: Record<string, unknown> = {};
  if (b.enabled !== undefined) data.mascotEnabled = b.enabled;
  if (b.character !== undefined) data.mascotCharacter = b.character;
  if (b.provider !== undefined) data.mascotProvider = b.provider;
  if (b.model !== undefined) data.mascotModel = b.model;
  if (b.taskModel !== undefined) data.aiTaskModel = b.taskModel || null;
  // Another provider has another catalogue: a task model left unset there follows the mascot again.
  else if (b.provider !== undefined && asMascotProvider(b.provider) !== asMascotProvider(current.mascotProvider)) data.aiTaskModel = null;
  if (b.baseUrl !== undefined) data.mascotBaseUrl = b.baseUrl || null;
  if (b.baseUrl && nextProvider === "custom" && !parsePublicHttpsUrl(b.baseUrl)) {
    throw ApiError.badRequest("La URL base no es válida. Usa una URL https pública.");
  }
  if (b.modelsUrl !== undefined) {
    const raw = b.modelsUrl || null;
    if (raw && !parsePublicHttpsUrl(raw)) {
      throw ApiError.badRequest("La URL de modelos no es válida. Usa https, por ejemplo https://api.groq.com/openai/v1/models");
    }
    data.mascotModelsUrl = raw;
  }
  if (b.usageUrl !== undefined) {
    const raw = b.usageUrl || null;
    if (raw && !parsePublicHttpsUrl(raw)) throw ApiError.badRequest("La URL de saldo no es válida. Usa una URL https pública.");
    data.mascotUsageUrl = raw;
  }
  if (b.clearKey) vault[nextProvider] = { enc: null, valid: false };
  if (b.apiKey) vault[nextProvider] = { enc: encryptSecret(b.apiKey), valid: false };
  if (b.clearFootballKey) data.mascotFootballKeyEnc = null;
  if (b.footballApiKey) {
    const ping = await pingFootballKey(b.footballApiKey);
    switch (ping) {
      case "ok":
        data.mascotFootballKeyEnc = encryptSecret(b.footballApiKey);
        break;
      case "invalid":
        throw ApiError.badRequest("La clave de football-data.org no es válida.");
      case "unreachable":
        throw ApiError.badRequest("No se pudo comprobar la clave de fútbol. Inténtalo de nuevo.");
      default: {
        const _never: never = ping;
        return _never;
      }
    }
  }
  data.mascotApiKeysEnc = serializeKeyVault(vault);
  data.mascotApiKeyEnc = keyEncFor(vault, nextProvider);
  const u = await prisma.user.update({
    where: { id: req.user!.id },
    data,
    select: SETTINGS_SELECT,
  });
  res.json({ settings: publicSettings(u) });
}));

mascotRouter.get("/usage", asyncHandler(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { mascotProvider: true, mascotBaseUrl: true, mascotUsageUrl: true, mascotApiKeyEnc: true, mascotApiKeysEnc: true },
  });
  if (u.mascotProvider !== "custom") {
    res.json({ status: "unsupported", message: "El proveedor no ofrece saldo desde la agenda." });
    return;
  }
  const vault = hydrateKeyVault(u.mascotApiKeysEnc, u.mascotApiKeyEnc, u.mascotProvider);
  const apiKeyEnc = keyEncFor(vault, "custom");
  const rawUrl = u.mascotUsageUrl || (u.mascotBaseUrl ? `${u.mascotBaseUrl.replace(/\/+$/, "")}/usage` : "");
  const url = parsePublicHttpsUrl(rawUrl);
  if (!apiKeyEnc || !url) {
    res.json({ status: "unavailable", message: "Configura una URL de saldo/uso del proveedor." });
    return;
  }
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${decryptSecret(apiKeyEnc)}` },
      signal: AbortSignal.timeout(8_000),
      redirect: "manual",
    });
    if (!response.ok) {
      res.json({ status: "unavailable", message: "El proveedor no ha devuelto el saldo." });
      return;
    }
    const body = await response.json() as unknown;
    const usage = extractUsage(body);
    res.json(usage ? { status: "available", ...usage } : { status: "unavailable", message: "Formato de saldo no reconocido." });
  } catch {
    res.json({ status: "unavailable", message: "No se pudo consultar el saldo ahora." });
  }
}));

function extractUsage(body: unknown): { remaining: number; currency?: string; resetAt?: string } | null {
  const root = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const candidates = ["remaining", "remaining_balance", "balance", "credits_remaining", "credits"];
  const remaining = candidates.map((key) => data[key]).find((value): value is number | string =>
    typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))));
  if (remaining === undefined) return null;
  const currency = typeof data.currency === "string" ? data.currency : undefined;
  const resetAt = typeof data.reset_at === "string" ? data.reset_at : typeof data.resetAt === "string" ? data.resetAt : undefined;
  return { remaining: Number(remaining), currency, resetAt };
}

mascotRouter.get("/models", asyncHandler(async (req, res) => {
  const raw = String(req.query.provider ?? "opencode");
  const provider: MascotProvider = raw === "openrouter" || raw === "custom" || raw === "opencode" ? raw : "opencode";
  switch (provider) {
    case "custom": {
      const u = await prisma.user.findUniqueOrThrow({
        where: { id: req.user!.id },
        select: { mascotProvider: true, mascotModelsUrl: true, mascotApiKeyEnc: true, mascotApiKeysEnc: true },
      });
      const vault = hydrateKeyVault(u.mascotApiKeysEnc, u.mascotApiKeyEnc, u.mascotProvider);
      const modelsUrl = String(req.query.modelsUrl ?? "").trim() || u.mascotModelsUrl || "";
      if (!modelsUrl) {
        res.json({ models: [] });
        return;
      }
      try {
        const enc = keyEncFor(vault, "custom");
        const key = enc ? decryptSecret(enc) : undefined;
        const ids = await fetchCustomCatalog(modelsUrl, key);
        res.json({ models: ids.map((id) => ({ id, label: id })) });
      } catch (e) {
        throw ApiError.badRequest(e instanceof Error ? e.message : "No se pudo leer el catálogo de modelos.");
      }
      return;
    }
    case "openrouter": {
      const ids = await fetchOpenRouterCatalog();
      res.json({ models: ids.map((id) => ({ id, label: id })) });
      return;
    }
    case "opencode": {
      const { go, zen } = await loadOpenCodeCatalogs();
      res.json({ models: [AUTO_FREE_OPTION, ...listOpencodeModels(go, zen)] });
      return;
    }
    default: {
      const _never: never = provider;
      return _never;
    }
  }
}));

function wantsStream(req: Request, body: { stream?: boolean }): boolean {
  if (body.stream === true) return true;
  const accept = req.headers.accept ?? "";
  return accept.includes("text/event-stream");
}

function sseWrite(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

mascotRouter.post("/chat", validate(chatSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof chatSchema>;
  const stream = wantsStream(req, body);
  if (stream) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
  }

  try {
    const out = await runMascotTurn({
      userId: req.user!.id,
      messages: body.messages,
      channel: "web",
      sessionId: body.sessionId,
      messagingContext: body.messagingContext,
      onDelta: stream ? (text) => sseWrite(res, "delta", { text }) : undefined,
    });
    if (stream) {
      sseWrite(res, "done", { reply: out.reply, model: out.model, actions: out.actions, preparedReplyId: out.preparedReplyId });
      res.end();
      return;
    }
    res.json({ reply: out.reply, model: out.model, actions: out.actions, preparedReplyId: out.preparedReplyId });
  } catch (err) {
    if (stream && res.headersSent) {
      const message = err instanceof ApiError ? err.message : "El proveedor de IA no pudo completar la petición.";
      sseWrite(res, "error", { message });
      res.end();
      return;
    }
    throw err;
  }
}));

mascotRouter.post("/test", asyncHandler(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { mascotProvider: true, mascotModel: true, mascotBaseUrl: true, mascotApiKeyEnc: true, mascotApiKeysEnc: true },
  });
  const provider = asMascotProvider(u.mascotProvider);
  const vault = hydrateKeyVault(u.mascotApiKeysEnc, u.mascotApiKeyEnc, u.mascotProvider);
  const apiKeyEnc = keyEncFor(vault, provider);
  if (!apiKeyEnc) throw ApiError.badRequest("Guarda primero una API key.");
  let model: string;
  let lane: OpenCodeLane | undefined;
  try {
    const target = await resolveChatTarget(provider, u.mascotModel || "auto-free");
    model = target.model;
    lane = target.lane;
  } catch (e) {
    if ((e as Error).name === "NoFreeGoModel") {
      throw ApiError.badRequest("Ahora mismo OpenCode no tiene modelos gratis; elige uno de tu plan Go o OpenRouter.");
    }
    throw e;
  }
  const ping = [
    { role: "system" as const, content: mascotSystemPrompt("Europe/Madrid") },
    { role: "user" as const, content: "Responde solo la palabra ok." },
  ];
  const call = (tools?: unknown[]) => completeChat({
    provider,
    apiKeyEnc,
    customBase: u.mascotBaseUrl,
    model,
    lane,
    sessionId: `kalendiario:test:${req.user!.id}`,
    messages: ping,
    ...(tools?.length ? { tools } : {}),
  });
  const markValid = async (valid: boolean) => {
    vault[provider] = { enc: apiKeyEnc, valid };
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { mascotApiKeysEnc: serializeKeyVault(vault), mascotApiKeyEnc: apiKeyEnc },
    });
  };
  try {
    let out;
    try {
      out = await call([...MASCOT_TOOLS]);
    } catch {
      out = await call();
    }
    await markValid(true);
    res.json({ ok: true, model, preview: (out.content || "ok").slice(0, 80) });
  } catch (err) {
    await markValid(false);
    throw err;
  }
}));
