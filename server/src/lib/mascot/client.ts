import { randomUUID } from "node:crypto";
import { decryptSecret } from "../crypto.js";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";
import { APP_NAME, APP_VERSION } from "../brand.js";
import type { MascotProvider, OpenCodeLane } from "./catalog.js";

const GO_BASE = "https://opencode.ai/zen/go/v1";
const ZEN_BASE = "https://opencode.ai/zen/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatResult = {
  content: string | null;
  tool_calls?: ToolCall[];
};

/** OpenCode Go exige un session id estable por conversación (docs: x-opencode-session). */
const SESSION_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

export function normalizeOpenCodeSessionId(raw: string | null | undefined, fallback?: string): string {
  const trimmed = (raw ?? "").trim();
  if (SESSION_RE.test(trimmed)) return trimmed;
  const fb = (fallback ?? "").trim();
  if (SESSION_RE.test(fb)) return fb;
  return randomUUID();
}

/** Headers required by OpenCode Go for routing / prompt cache. */
export function opencodeRequestHeaders(sessionId: string): Record<string, string> {
  return {
    "User-Agent": `${APP_NAME}/${APP_VERSION}`,
    "x-opencode-session": normalizeOpenCodeSessionId(sessionId),
  };
}

function opencodeBase(lane: OpenCodeLane): string {
  switch (lane) {
    case "zen":
      return ZEN_BASE;
    case "go":
      return GO_BASE;
    default: {
      const _never: never = lane;
      return _never;
    }
  }
}

function endpoints(
  provider: MascotProvider,
  customBase?: string | null,
  lane: OpenCodeLane = "go",
  sessionId?: string | null,
): { base: string; extra: Record<string, string> } {
  if (provider === "opencode") {
    return {
      base: opencodeBase(lane),
      extra: opencodeRequestHeaders(normalizeOpenCodeSessionId(sessionId)),
    };
  }
  if (provider === "openrouter") {
    return {
      base: OPENROUTER_BASE,
      extra: { "HTTP-Referer": "https://tu-dominio.example", "X-Title": APP_NAME },
    };
  }
  const base = (customBase ?? "").replace(/\/+$/, "");
  if (!base) throw ApiError.badRequest("Falta la URL base del proveedor personalizado.");
  return { base, extra: {} };
}

export function providerErrorMessage(raw: string): string {
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    const fromObj = typeof j.error === "object" && j.error?.message ? j.error.message : "";
    const fromStr = typeof j.error === "string" ? j.error : "";
    const msg = (fromObj || fromStr || j.message || "").trim();
    if (!msg || msg.includes("<") || msg.length > 220) return "";
    return msg;
  } catch {
    return "";
  }
}

type StreamDelta = {
  content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
};

async function completeChatStream(
  base: string,
  extra: Record<string, string>,
  key: string,
  opts: {
    model: string;
    messages: ChatMessage[];
    tools?: unknown[];
    onDelta?: (chunk: string) => void;
  },
): Promise<ChatResult> {
  const payload: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: 0.4,
    max_tokens: 400,
    stream: true,
  };
  if (opts.tools?.length) {
    payload.tools = opts.tools;
    payload.tool_choice = "auto";
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    throw friendlyLlmError(res.status, await res.text());
  }
  if (!res.body) throw ApiError.badRequest("El proveedor no envió un cuerpo en streaming.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  const toolMap = new Map<number, { id: string; name: string; arguments: string }>();

  const consumeLine = (line: string) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let json: { choices?: { delta?: StreamDelta }[] };
    try {
      json = JSON.parse(data) as { choices?: { delta?: StreamDelta }[] };
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      content += delta.content;
      opts.onDelta?.(delta.content);
    }
    if (!delta.tool_calls) return;
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      const cur = toolMap.get(idx) ?? { id: "", name: "", arguments: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.arguments += tc.function.arguments;
      toolMap.set(idx, cur);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }
  if (buf.trim()) consumeLine(buf);

  const tool_calls: ToolCall[] = [...toolMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id || `call_${t.name}`,
      type: "function" as const,
      function: { name: t.name, arguments: t.arguments || "{}" },
    }))
    .filter((t) => t.function.name);

  return { content: content || null, tool_calls: tool_calls.length ? tool_calls : undefined };
}

export async function completeChat(opts: {
  provider: MascotProvider;
  apiKeyEnc: string;
  customBase?: string | null;
  model: string;
  lane?: OpenCodeLane;
  /** Stable conversation id for OpenCode (`x-opencode-session`). */
  sessionId?: string | null;
  messages: ChatMessage[];
  tools?: unknown[];
  probe?: boolean;
  onDelta?: (chunk: string) => void;
}): Promise<ChatResult> {
  const key = decryptSecret(opts.apiKeyEnc);
  const { base, extra } = endpoints(opts.provider, opts.customBase, opts.lane, opts.sessionId);
  if (opts.onDelta && !opts.probe) {
    let streamed = false;
    try {
      return await completeChatStream(base, extra, key, {
        model: opts.model,
        messages: opts.messages,
        tools: opts.tools,
        onDelta: (chunk) => {
          streamed = true;
          opts.onDelta?.(chunk);
        },
      });
    } catch (err) {
      if (streamed) throw err;
      logger.warn({ err }, "mascot stream failed; falling back");
    }
  }
  const attempts: Record<string, unknown>[] = opts.probe
    ? [
      { model: opts.model, messages: opts.messages },
      { model: opts.model, messages: opts.messages, max_tokens: 64 },
      {
        model: opts.model,
        messages: opts.messages,
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
        max_tokens: 64,
      },
    ]
    : [
      {
        model: opts.model,
        messages: opts.messages,
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
        temperature: 0.4,
        max_tokens: 400,
        ...(opts.tools?.length ? { tool_choice: "auto" } : {}),
      },
    ];

  let lastStatus = 0;
  let lastRaw = "";
  for (const payload of attempts) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...extra,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });
    const raw = await res.text();
    if (!res.ok) {
      lastStatus = res.status;
      lastRaw = raw;
      const retryable = opts.probe && (res.status === 400 || res.status === 422);
      if (retryable) continue;
      throw friendlyLlmError(res.status, raw, opts.lane);
    }
    let json: { choices?: { message?: ChatResult }[] };
    try {
      json = JSON.parse(raw) as { choices?: { message?: ChatResult }[] };
    } catch {
      throw ApiError.badRequest("El modelo respondió en un formato extraño.");
    }
    const msg = json.choices?.[0]?.message;
    if (!msg) {
      if (opts.probe) return { content: "" };
      throw ApiError.badRequest("El modelo no devolvió mensaje.");
    }
    if (opts.onDelta && msg.content) opts.onDelta(msg.content);
    return { content: msg.content ?? null, tool_calls: msg.tool_calls };
  }
  logger.warn({ status: lastStatus }, "mascot provider probe failed");
  throw friendlyLlmError(lastStatus || 502, lastRaw, opts.lane);
}

/**
 * One short, tool-less completion for the task assistants. Bounded output,
 * one deadline for every attempt and a hint to reason little so the answer
 * comes back fast; providers that reject that hint get a plain retry.
 */
export async function completeFast(opts: {
  provider: MascotProvider;
  apiKeyEnc: string;
  customBase?: string | null;
  model: string;
  lane?: OpenCodeLane;
  sessionId?: string | null;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
  const key = decryptSecret(opts.apiKeyEnc);
  const { base, extra } = endpoints(opts.provider, opts.customBase, opts.lane, opts.sessionId);
  const plain: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens,
  };
  // Ask every provider to think little; the ones that reject the hint get a plain retry.
  const hinted = opts.provider === "openrouter"
    ? { ...plain, reasoning: { effort: "low", exclude: true } }
    : { ...plain, reasoning_effort: "low" };
  const attempts: Record<string, unknown>[] = [hinted, plain];
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let lastStatus = 0;
  let lastRaw = "";
  let grown = false;
  for (let i = 0; i < attempts.length; i += 1) {
    const payload = attempts[i]!;
    const left = deadline - Date.now();
    if (left < 1_000) break;
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(left),
      });
    } catch (err) {
      const name = (err as Error).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw ApiError.badRequest("La IA ha tardado demasiado. Prueba de nuevo o elige un modelo más rápido.");
      }
      throw ApiError.badRequest("No se pudo contactar con el proveedor de IA.");
    }
    const raw = await res.text();
    if (!res.ok) {
      lastStatus = res.status;
      lastRaw = raw;
      if ((res.status === 400 || res.status === 422) && payload === hinted) continue;
      throw friendlyLlmError(res.status, raw, opts.lane);
    }
    let content = "";
    let finish = "";
    try {
      const json = JSON.parse(raw) as { choices?: { message?: { content?: string | null }; finish_reason?: string | null }[] };
      content = (json.choices?.[0]?.message?.content ?? "").trim();
      finish = json.choices?.[0]?.finish_reason ?? "";
    } catch {
      throw ApiError.badRequest("El modelo respondió en un formato extraño.");
    }
    // A reasoning model can spend the whole budget thinking: one retry with more room.
    if (!content && finish === "length" && !grown) {
      grown = true;
      attempts.splice(i + 1, attempts.length, { ...payload, max_tokens: Math.min(opts.maxTokens * 2, 12_000) });
      continue;
    }
    return content;
  }
  if (!lastStatus) throw ApiError.badRequest("La IA no llegó a escribir la respuesta. Prueba de nuevo o elige un modelo más rápido.");
  throw friendlyLlmError(lastStatus, lastRaw, opts.lane);
}

/** Provider refusals that mean "this key cannot use this model" (a fallback model may still work). */
export class ProviderAuthError extends ApiError {}

function friendlyLlmError(status: number, raw: string, lane?: OpenCodeLane): ApiError {
  const lower = raw.toLowerCase();
  if (lower.includes("freetiererror") || lower.includes("free tier can only be used")) {
    return new ProviderAuthError(400, "BAD_REQUEST", "Los modelos gratis de OpenCode Zen solo funcionan dentro de la app OpenCode. Elige un modelo de tu plan Go.");
  }
  if (status === 401 || status === 403) {
    return new ProviderAuthError(400, "BAD_REQUEST", lane === "zen"
      ? "Tu API key no sirve para los modelos Zen (los «gratis»). Con una clave de OpenCode Go elige un modelo de Go."
      : "API key inválida o sin permiso para ese modelo.");
  }
  if (status === 429 || lower.includes("quota") || lower.includes("limit")) {
    return ApiError.badRequest("Límite de uso de OpenCode/Go (o del proveedor). Prueba más tarde o cambia de modelo.");
  }
  if (lower.includes("x-opencode-session") || (lower.includes("session") && lower.includes("unavailable"))) {
    return ApiError.badRequest("OpenCode pide un identificador de sesión (x-opencode-session). Recarga y prueba de nuevo.");
  }
  const detail = providerErrorMessage(raw);
  if (detail) return ApiError.badRequest(`El proveedor rechazó la petición: ${detail}`);
  return ApiError.badRequest("El proveedor de IA no pudo completar la petición.");
}
