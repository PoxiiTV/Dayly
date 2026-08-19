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
    const body = rest.body ? JSON.parse(String(rest.body)) : undefined;
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

/* Convenience verbs */
export const http = {
  get: <T>(p: string, query?: Record<string, unknown>) => api<T>(p, { query: query as never }),
  post: <T>(p: string, data?: unknown, query?: Record<string, unknown>) =>
    api<T>(p, { method: "POST", body: data ? JSON.stringify(data) : undefined, query: query as never }),
  patch: <T>(p: string, data?: unknown) => api<T>(p, { method: "PATCH", body: JSON.stringify(data ?? {}) }),
  del: <T>(p: string) => api<T>(p, { method: "DELETE" }),
};
