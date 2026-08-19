import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { useToast } from "@/components/ui";

type Fired = { id: string; type: string; title: string; body: string; actionUrl: string };

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enableWebPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const vapid = await http.get<{ publicKey: string | null }>("/api/push/vapid");
  if (!vapid.publicKey) return false;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  const reg = await navigator.serviceWorker.register("/dayly-push.js", { scope: "/push-sw/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  await http.post("/api/push/subscribe", { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return true;
}

export function AlertEngine() {
  const { push } = useToast();
  const qc = useQueryClient();
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState === "hidden") return;
      try {
        const r = await http.post<{ fired: Fired[] }>("/api/alerts/tick");
        for (const f of r.fired ?? []) {
          if (seen.current.has(f.id)) continue;
          seen.current.add(f.id);
          push("success", f.title);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try { new Notification(f.title, { body: f.body, icon: `${import.meta.env.BASE_URL}brand/icon-192.png` }); } catch { /* ignore */ }
          }
        }
        if ((r.fired ?? []).length) qc.invalidateQueries({ queryKey: ["notifications"] });
      } catch { /* offline / 401 */ }
    };
    const ask = async () => {
      if (typeof Notification === "undefined" || Notification.permission !== "default") return;
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    };
    void ask().then(tick);
    const id = window.setInterval(tick, 45_000);
    const vis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; window.clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [push, qc]);

  return null;
}
