import { useEffect, useState } from "react";
import { Sunrise, Send } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { Button, Select, Spinner, useToast } from "@/components/ui";

type BriefingSettings = {
  enabled: boolean;
  hour: number;
  telegramChatId: string | null;
};

export function BriefingSettings() {
  const { push } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["briefing-settings"],
    queryFn: () => http.get<{ settings: BriefingSettings; botConfigured: boolean }>("/api/briefing/settings"),
  });
  const s = data?.settings;
  const botConfigured = data?.botConfigured ?? false;

  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(8);
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!s) return;
    setEnabled(s.enabled);
    setHour(s.hour);
    setChatId(s.telegramChatId ?? "");
  }, [s]);

  const save = async (overrides?: { enabled?: boolean }) => {
    setBusy(true);
    try {
      const r = await http.patch<{ settings: BriefingSettings }>("/api/briefing/settings", {
        enabled: overrides?.enabled ?? enabled,
        hour,
        telegramChatId: chatId.trim() ? chatId.trim() : undefined,
        clearTelegram: chatId.trim() === "" ? true : undefined,
      });
      qc.setQueryData(["briefing-settings"], { settings: r.settings, botConfigured });
      setEnabled(r.settings.enabled);
      setHour(r.settings.hour);
      setChatId(r.settings.telegramChatId ?? "");
      push("success", "Resumen matinal actualizado");
    } catch {
      push("error", "No se pudo guardar el resumen.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (next: boolean) => {
    setEnabled(next);
    await save({ enabled: next });
  };

  const testNow = async () => {
    setTesting(true);
    try {
      await http.post("/api/briefing/test");
      push("success", "Resumen enviado de prueba. Revisa campana, push y Telegram.");
    } catch {
      push("error", "No se pudo enviar la prueba.");
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) {
    return (
      <section className="card p-5" id="briefing">
        <h2 className="font-semibold text-text flex items-center gap-2 mb-4 text-sm uppercase tracking-wide text-faint">
          <Sunrise className="w-4 h-4" />Resumen matinal
        </h2>
        <Spinner />
      </section>
    );
  }

  return (
    <section className="card p-5" id="briefing">
      <h2 className="font-semibold text-text flex items-center gap-2 mb-4 text-sm uppercase tracking-wide text-faint">
        <Sunrise className="w-4 h-4" />Resumen matinal
      </h2>
      <p className="text-sm text-muted mb-4">Cada mañana Calen te resume el día: pendientes, atrasadas, eventos, hábitos y el tiempo, a la hora que elijas.</p>

      <div className="rounded-xl border border-border/70 overflow-hidden mb-4">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => void toggle(!enabled)}
          className="flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left text-sm text-text hover:bg-surface/80"
        >
          <span>Activar resumen diario</span>
          <span className={enabled ? "relative shrink-0 h-5 w-9 rounded-full bg-accent" : "relative shrink-0 h-5 w-9 rounded-full bg-border"}>
            <span className={enabled ? "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm translate-x-[18px]" : "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm"} />
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select label="Hora" value={String(hour)} onChange={(e) => setHour(Number(e.target.value))}>
          {[6, 7, 8, 9, 10, 11, 12].map((h) => (
            <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
          ))}
        </Select>
      </div>

      {botConfigured ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1">
            <label className="label">Chat de Telegram (chat-id)</label>
            <input className="input" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789" />
          </div>
          <Button type="button" size="sm" variant="ghost" className="mt-5" onClick={() => { setChatId(""); }}>Quitar</Button>
        </div>
      ) : (
        <p className="text-xs text-faint mt-3">Telegram no configurado en este servidor. Crea el bot con @BotFather y añade TELEGRAM_BOT_TOKEN en el .env para activar este canal.</p>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testNow()} disabled={testing}>{testing ? <Spinner /> : <Send className="w-4 h-4" />} Probar</Button>
      </div>
    </section>
  );
}