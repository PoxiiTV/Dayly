import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, http } from "@/lib/api";
import { useToast } from "@/components/ui";
import { playNotifySound } from "@/lib/notifySounds";
import { enableNativeNotifications, isNativeShell, sendNativeNotification } from "@/lib/nativeShell";
import { isParkedInTray, watchTrayState } from "@/lib/trayState";

type Fired = {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string;
  taskId?: string;
  occurrenceAt?: string;
};

export type EnablePushResult = { ok: true; detail: string } | { ok: false; detail: string };

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64.trim() + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function notifyIcon(): string {
  return `${import.meta.env.BASE_URL}brand/icon-192.png`;
}

function showPushTestNotification() {
  playNotifySound();
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification("Prueba de avisos", {
      body: "Si ves esto, Dayly puede avisarte en este navegador.",
      icon: notifyIcon(),
      tag: "dayly-push-test",
    });
  } catch {
    // Some embedded browsers expose Notification but reject the constructor.
  }
}

async function waitUntilActive(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Tiempo agotado al activar avisos.")), 8000);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        window.clearTimeout(timer);
        resolve();
      }
      if (worker.state === "redundant") {
        window.clearTimeout(timer);
        reject(new Error("El worker de avisos no se pudo activar."));
      }
    });
  });
}

async function activatePushWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/push-sw/");
  const reg = existing ?? await navigator.serviceWorker.register("/dayly-push.js", { scope: "/push-sw/" });
  await waitUntilActive(reg);
  return reg;
}

async function subscribeWebPush(publicKey: string): Promise<void> {
  const reg = await activatePushWorker();
  const key = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch {
      const stale = await reg.pushManager.getSubscription();
      if (stale) await stale.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("El navegador no devolvió una suscripción push válida.");
  }
  await http.post("/api/push/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
}

/**
 * Must run from a click: permission is requested before any other await,
 * same as the Spotify arming rule. Then a local test notification fires
 * (the same channel task alerts use with the tab open) and, if VAPID is
 * configured, the closed-tab worker is subscribed.
 */
export async function enableWebPush(): Promise<EnablePushResult> {
  if (isNativeShell()) {
    const result = await enableNativeNotifications();
    return result.ok ? { ok: true, detail: result.detail } : { ok: false, detail: result.detail };
  }
  if (typeof Notification === "undefined") {
    return { ok: false, detail: "Este navegador no admite avisos." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, detail: "Has bloqueado los avisos. Permítelos en el candado de la barra de direcciones y vuelve a pulsar." };
  }

  showPushTestNotification();

  if (import.meta.env.VITE_APP_DEMO === "1") {
    return { ok: true, detail: "Aviso de prueba enviado." };
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: true, detail: "Aviso de prueba enviado. Este navegador no guarda avisos con la pestaña cerrada." };
  }

  try {
    const vapid = await api<{ publicKey: string | null }>("/api/push/vapid", { cache: "no-store" });
    if (!vapid.publicKey) {
      return { ok: true, detail: "Aviso de prueba enviado. Faltan las claves VAPID del servidor para avisos con la pestaña cerrada." };
    }
    await subscribeWebPush(vapid.publicKey);
    await http.post("/api/push/test");
    return { ok: true, detail: "Aviso de prueba enviado. También llegarán con la pestaña cerrada." };
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo registrar el aviso en segundo plano.";
    return { ok: true, detail: `Aviso de prueba enviado. ${message}` };
  }
}

async function hasWebPushSubscription(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/push-sw/");
    return Boolean(registration && await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export function AlertEngine() {
  const { push } = useToast();
  const qc = useQueryClient();
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let stop = false;
    const native = isNativeShell();
    const parked = { current: isParkedInTray() };
    const stopTray = native ? watchTrayState((value) => { parked.current = value; }) : () => {};
    const claim = (id: string) => {
      if (seen.current.has(id)) return false;
      try {
        const key = "dayly.alert.seen";
        const now = Date.now();
        const stored = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, number>;
        for (const [oldId, timestamp] of Object.entries(stored)) {
          if (!Number.isFinite(timestamp) || now - timestamp > 2 * 86400_000) delete stored[oldId];
        }
        if (stored[id]) return false;
        stored[id] = now;
        localStorage.setItem(key, JSON.stringify(stored));
      } catch { /* private mode or unavailable storage: keep in-memory dedupe */ }
      seen.current.add(id);
      return true;
    };
    const showForeground = (f: Fired) => {
      if (!f.id || !claim(f.id)) return;
      const reminder = f.type === "REMINDER";
      const task = f.type === "TASK" && f.taskId ? f : null;
      const actions = task
        ? [
          { label: "Abrir tarea", onClick: () => window.location.assign(task.actionUrl) },
          {
            label: "Posponer 10 min",
            onClick: () => {
              void http.post(`/api/tasks/${encodeURIComponent(task.taskId!)}/snooze`, { minutes: 10, occurrenceAt: task.occurrenceAt })
                .then(() => {
                  void qc.invalidateQueries({ queryKey: ["tasks"] });
                  push("success", "Tarea pospuesta 10 minutos.");
                })
                .catch((error: unknown) => push("error", error instanceof Error ? error.message : "No se pudo posponer la tarea."));
            },
          },
        ]
        : reminder
          ? [{ label: "Abrir recordatorio", onClick: () => window.location.assign(f.actionUrl) }]
          : undefined;
      push("success", `⏰ ${f.title}\n${f.body}`, actions);
      playNotifySound();
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    };
    const tick = async () => {
      const hidden = document.visibilityState === "hidden" || parked.current;
      if (stop || (hidden && !native)) return;
      try {
        const r = await http.post<{ fired: Fired[] }>("/api/alerts/tick");
        for (const f of r.fired ?? []) {
          if (native && hidden) {
            // The server already sends Web Push to a registered subscription.
            // Use the native Windows toast only when this shell has no push
            // subscription, avoiding two system notifications for one task.
            if (!(await hasWebPushSubscription())) {
              await sendNativeNotification(f.title, f.body);
            }
            claim(f.id);
            continue;
          }
          showForeground(f);
        }
        if ((r.fired ?? []).length) qc.invalidateQueries({ queryKey: ["notifications"] });
      } catch { /* offline / 401 */ }
    };
    const onSw = (e: MessageEvent) => {
      if (e.data?.type === "dayly-alert" && e.data.alert) {
        showForeground(e.data.alert as Fired);
      } else if (e.data?.type === "dayly-notify-sound") playNotifySound(e.data.sound);
    };
    navigator.serviceWorker?.addEventListener("message", onSw);
    void tick();
    const id = window.setInterval(tick, native ? 30_000 : 45_000);
    const vis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => {
      stop = true;
      window.clearInterval(id);
      stopTray();
      document.removeEventListener("visibilitychange", vis);
      navigator.serviceWorker?.removeEventListener("message", onSw);
    };
  }, [push, qc]);

  return null;
}
