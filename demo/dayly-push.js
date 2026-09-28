const SOUNDS = new Set(["bell", "ring", "chime", "ding", "digital", "wood", "crystal", "marimba"]);

function soundId(value) {
  if (value === "off") return "off";
  return typeof value === "string" && SOUNDS.has(value) ? value : "bell";
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { id: undefined, title: "Dayly", body: "", url: "/", sound: "bell", taskId: undefined, occurrenceAt: undefined };
  try { data = { ...data, ...(event.data ? event.data.json() : {}) }; } catch { /* ignore */ }
  const sound = soundId(data.sound);
  const muted = sound === "off";
  const soundUrl = muted ? undefined : `/sounds/${sound}.wav`;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visible = windows.filter((c) => c.focused || c.visibilityState === "visible");
    if (visible.length) {
      for (const client of visible) {
        client.postMessage({
          type: "dayly-alert",
          alert: { id: data.id, type: data.taskId ? "TASK" : "REMINDER", title: data.title, body: data.body, actionUrl: data.url || "/", taskId: data.taskId, occurrenceAt: data.occurrenceAt },
        });
      }
      return;
    }
    if (!muted) {
      for (const client of windows) {
        client.postMessage({ type: "dayly-notify-sound", sound });
      }
    }
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/brand/icon-192.png",
      badge: "/brand/icon-192.png",
      silent: muted || windows.length > 0,
      sound: soundUrl,
      tag: data.taskId && data.occurrenceAt ? `dayly-task-${data.taskId}-${data.occurrenceAt}` : undefined,
      actions: data.taskId ? [
        { action: "open", title: "Abrir" },
        { action: "snooze", title: "Posponer 10 min" },
      ] : undefined,
      data: { id: data.id, url: data.url || "/", sound, taskId: data.taskId, occurrenceAt: data.occurrenceAt },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/";
  event.waitUntil((async () => {
    if (event.action === "snooze" && data.taskId) {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(data.taskId)}/snooze`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes: 10, occurrenceAt: data.occurrenceAt }),
        });
        if (!response.ok) throw new Error("snooze failed");
      } catch {
        // Opening the task leaves the same action available in the app.
      }
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => "focus" in client);
    if (existing) {
      await existing.focus();
      await existing.navigate(url);
    } else {
      await self.clients.openWindow(url);
    }
  })());
});
