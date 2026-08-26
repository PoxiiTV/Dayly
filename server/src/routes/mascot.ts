import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { AUTO_FREE_OPTION, fetchCustomCatalog, fetchOpenRouterCatalog, listOpencodeModels, loadOpenCodeCatalogs, parsePublicHttpsUrl, resolveChatTarget, type MascotProvider, type OpenCodeLane } from "../lib/mascot/catalog.js";
import { asMascotProvider, hydrateKeyVault, keyEncFor, publicKeyStatus, serializeKeyVault } from "../lib/mascot/keys.js";
import { completeChat, type ChatMessage } from "../lib/mascot/client.js";
import { memoryBlurb, buildDayContext } from "../lib/mascot/context.js";
import { systemPrompt } from "../lib/mascot/prompt.js";
import { MASCOT_TOOLS, parseToolArgs, runMascotTool } from "../lib/mascot/tools.js";

export const mascotRouter = Router();
mascotRouter.use(requireAuth);

const providerZ = z.enum(["opencode", "openrouter", "custom"]);

const patchSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  provider: providerZ.optional(),
  model: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().max(300).nullish(),
  modelsUrl: z.string().trim().max(300).nullish(),
  apiKey: z.string().trim().min(8).max(400).optional(),
  clearKey: z.boolean().optional(),
});

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })).min(1).max(24),
  stream: z.boolean().optional(),
});

function publicSettings(u: {
  mascotEnabled: boolean;
  mascotProvider: string;
  mascotModel: string;
  mascotBaseUrl: string | null;
  mascotModelsUrl: string | null;
  mascotApiKeyEnc: string | null;
  mascotApiKeysEnc: string | null;
}) {
  const provider = asMascotProvider(u.mascotProvider);
  const vault = hydrateKeyVault(u.mascotApiKeysEnc, u.mascotApiKeyEnc, u.mascotProvider);
  const keys = publicKeyStatus(vault);
  const current = keys[provider];
  return {
    enabled: u.mascotEnabled,
    provider: u.mascotProvider,
    model: u.mascotModel,
    baseUrl: u.mascotBaseUrl,
    modelsUrl: u.mascotModelsUrl,
    hasKey: current.hasKey,
    keyValid: current.valid,
    keys,
  };
}

const SETTINGS_SELECT = {
  mascotEnabled: true,
  mascotProvider: true,
  mascotModel: true,
  mascotBaseUrl: true,
  mascotModelsUrl: true,
  mascotApiKeyEnc: true,
  mascotApiKeysEnc: true,
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
  if (b.provider !== undefined) data.mascotProvider = b.provider;
  if (b.model !== undefined) data.mascotModel = b.model;
  if (b.baseUrl !== undefined) data.mascotBaseUrl = b.baseUrl || null;
  if (b.modelsUrl !== undefined) {
    const raw = b.modelsUrl || null;
    if (raw && !parsePublicHttpsUrl(raw)) {
      throw ApiError.badRequest("La URL de modelos no es válida. Usa https, por ejemplo https://api.groq.com/openai/v1/models");
    }
    data.mascotModelsUrl = raw;
  }
  if (b.clearKey) vault[nextProvider] = { enc: null, valid: false };
  if (b.apiKey) vault[nextProvider] = { enc: encryptSecret(b.apiKey), valid: false };
  data.mascotApiKeysEnc = serializeKeyVault(vault);
  data.mascotApiKeyEnc = keyEncFor(vault, nextProvider);
  const u = await prisma.user.update({
    where: { id: req.user!.id },
    data,
    select: SETTINGS_SELECT,
  });
  res.json({ settings: publicSettings(u) });
}));

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
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { timezone: true, city: true, mascotProvider: true, mascotModel: true, mascotBaseUrl: true, mascotApiKeyEnc: true, mascotApiKeysEnc: true },
  });
  const provider = asMascotProvider(u.mascotProvider);
  const vault = hydrateKeyVault(u.mascotApiKeysEnc, u.mascotApiKeyEnc, u.mascotProvider);
  const apiKeyEnc = keyEncFor(vault, provider);
  if (!apiKeyEnc) throw ApiError.badRequest("Configura la API key de la mascota en Ajustes.");
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

  const stream = wantsStream(req, body);
  if (stream) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
  }

  const [memory, dayContext] = await Promise.all([
    memoryBlurb(req.user!.id),
    buildDayContext(req.user!.id, u.timezone || "Europe/Madrid"),
  ]);
  const extraSystem: string[] = [];
  if (memory) extraSystem.push(`Lo que recuerdas tuyo:\n${memory}`);
  extraSystem.push(dayContext);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(u.timezone, u.city) },
    { role: "system", content: extraSystem.join("\n\n") },
    ...body.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    let reply = "";
    for (let i = 0; i < 6; i++) {
      const out = await completeChat({
        provider,
        apiKeyEnc,
        customBase: u.mascotBaseUrl,
        model,
        lane,
        messages,
        tools: [...MASCOT_TOOLS],
        onDelta: stream ? (text) => sseWrite(res, "delta", { text }) : undefined,
      });
      if (out.tool_calls?.length) {
        messages.push({ role: "assistant", content: out.content, tool_calls: out.tool_calls });
        for (const call of out.tool_calls) {
          const parsed = parseToolArgs(call.function.arguments);
          const result = await runMascotTool(req.user!.id, u.timezone, call.function.name, parsed);
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
        continue;
      }
      reply = (out.content ?? "").trim();
      break;
    }
    if (!reply) reply = "No pude completar la acción. ¿Lo intentamos de otra forma?";
    if (stream) {
      sseWrite(res, "done", { reply, model });
      res.end();
      return;
    }
    res.json({ reply, model });
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
    { role: "system" as const, content: systemPrompt("Europe/Madrid") },
    { role: "user" as const, content: "Responde solo la palabra ok." },
  ];
  const call = (tools?: unknown[]) => completeChat({
    provider,
    apiKeyEnc,
    customBase: u.mascotBaseUrl,
    model,
    lane,
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
