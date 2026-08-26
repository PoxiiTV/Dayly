import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Fired when a 401 proves the session is dead; the app reacts by logging out. */
export const onUnauthorized = new Set<() => void>();

/**
 * Typed fetch wrapper. Credentials (HttpOnly cookie) are always sent; API
 * errors are normalized to ApiError with human-friendly messages.
 *
 * DEMO MODE: when VITE_APP_DEMO=1 every request is answered by an in-memory
 * mock (no network, no backend, resets on each page load).
 */
const DEMO = import.meta.env.VITE_APP_DEMO === "1";
if (DEMO) {
  void import("./demo");
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;
  let url = path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }

  if (DEMO) {
    const { demoHandle } = await import("./demo");
    const u = new URL(url, window.location.origin);
    const q: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      q[k] = v;
    });
    const body = rest.body instanceof FormData
      ? rest.body
      : rest.body
        ? JSON.parse(String(rest.body))
        : undefined;
    try {
      return (await demoHandle(rest.method ?? "GET", u.pathname, body, q)) as T;
    } catch (err) {
      const status = (err as { status?: number })?.status ?? 500;
      const code = status === 404 ? "NOT_FOUND" : "ERROR";
      throw new ApiError(status, code, status === 404 ? "No encontrado en la demo." : "Error en la demo.", undefined);
    }
  }

  const headers = new Headers(rest.headers);
  if (rest.body && !(rest.body instanceof FormData)) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers, credentials: "include" });
  } catch {
    throw new ApiError(0, "NETWORK", "No hay conexión. Comprueba tu conexión e inténtalo de nuevo.");
  }

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }

  if (!res.ok) {
    const err = (body as ApiErrorBody)?.error;
    const message = err?.message ?? "Ha ocurrido un error inesperado.";
    if (res.status === 401) onUnauthorized.forEach((cb) => cb());
    throw new ApiError(res.status, err?.code ?? "ERROR", message, err?.details);
  }

  return body as T;
}

export async function getAttachmentBlob(taskId: string, attId: string): Promise<Blob> {
  return fetchStoredBlob(`/api/tasks/${taskId}/attachments/${attId}`);
}

export async function getNoteAttachmentBlob(noteId: string, attId: string): Promise<Blob> {
  return fetchStoredBlob(`/api/notes/${noteId}/attachments/${attId}`);
}

async function fetchStoredBlob(path: string): Promise<Blob> {
  if (DEMO) {
    const { demoHandle } = await import("./demo");
    const r = await demoHandle("GET", path, undefined, {}) as { mimeType: string; data: string };
    const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    return new Blob([bin], { type: r.mimeType });
  }
  let res: Response;
  try {
    res = await fetch(path, { credentials: "include" });
  } catch {
    throw new ApiError(0, "NETWORK", "No hay conexión. Comprueba tu conexión e inténtalo de nuevo.");
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized.forEach((cb) => cb());
    throw new ApiError(res.status, "ERROR", "No se pudo abrir el archivo.");
  }
  return res.blob();
}

export async function streamMascotChat(
  messages: { role: "user" | "assistant"; content: string }[],
  onDelta: (chunk: string) => void,
): Promise<{ reply: string; model: string }> {
  if (DEMO) {
    const res = await http.post<{ reply: string; model: string }>("/api/mascot/chat", { messages });
    if (res.reply) onDelta(res.reply);
    return res;
  }
  let res: Response;
  try {
    res = await fetch("/api/mascot/chat", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages, stream: true }),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "No hay conexión. Comprueba tu conexión e inténtalo de nuevo.");
  }
  if (res.status === 401) onUnauthorized.forEach((cb) => cb());
  const ctype = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    let body: unknown = null;
    const text = await res.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    const err = (body as ApiErrorBody)?.error;
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? "Ha ocurrido un error inesperado.");
  }
  if (!ctype.includes("text/event-stream") || !res.body) {
    const body = await res.json() as { reply: string; model: string };
    if (body.reply) onDelta(body.reply);
    return { reply: body.reply, model: body.model };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let reply = "";
  let model = "";
  let errorMsg: string | null = null;
  const consumeBlock = (block: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    const raw = dataLines.join("\n");
    if (!raw) return;
    let json: { text?: string; reply?: string; model?: string; message?: string };
    try {
      json = JSON.parse(raw) as { text?: string; reply?: string; model?: string; message?: string };
    } catch {
      return;
    }
    if (event === "delta" && typeof json.text === "string") {
      reply += json.text;
      onDelta(json.text);
    }
    if (event === "done") {
      if (typeof json.reply === "string") reply = json.reply;
      if (typeof json.model === "string") model = json.model;
    }
    if (event === "error" && json.message) errorMsg = json.message;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const block of blocks) consumeBlock(block);
  }
  if (buf.trim()) consumeBlock(buf);
  if (errorMsg) throw new ApiError(502, "ERROR", errorMsg);
  return { reply, model };
}

/* Convenience verbs */
export const http = {
  get: <T>(p: string, query?: Record<string, unknown>) => api<T>(p, { query: query as never }),
  post: <T>(p: string, data?: unknown, query?: Record<string, unknown>) =>
    api<T>(p, { method: "POST", body: data ? JSON.stringify(data) : undefined, query: query as never }),
  postForm: <T>(p: string, data: FormData) => api<T>(p, { method: "POST", body: data }),
  patch: <T>(p: string, data?: unknown) => api<T>(p, { method: "PATCH", body: JSON.stringify(data ?? {}) }),
  del: <T>(p: string) => api<T>(p, { method: "DELETE" }),
};
