import { useEffect, useState } from "react";
import { Sunrise, Send } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { Button, Select, Spinner, useToast, Section, Toggle } from "@/components/ui";

type B = {
  enabled: boolean;
  hour: number;
  telegramChatId: string | null;
};

export function BriefingSettings() {
  const { push } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["briefing-settings"],
    queryFn: () => http.get<{ settings: B; botConfigured: boolean }>("/api/briefing/settings"),
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

  const save = async (nextEnabled?: boolean) => {
    setBusy(true);
    try {
      const r = await http.patch<{ settings: B }>("/api/briefing/settings", {
        enabled: nextEnabled ?? enabled,
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
      <Section id="briefing" icon={<Sunrise className="w-4 h-4" />} title="Resumen matinal">
        <Spinner />
      </Section>
    );
  }

  return (
    <Section id="briefing" icon={<Sunrise className="w-4 h-4" />} title="Resumen matinal">
      <p className="text-sm text-muted mb-4">Cada mañana Calen te resume pendientes, eventos, hábitos y el tiempo, a la hora que elijas.</p>

      <div className="rounded-xl border border-border/70 overflow-hidden mb-4">
        <Toggle label="Activar resumen diario" on={enabled} set={(v) => void save(v)} />
      </div>

      <label className="label">Hora</label>
      <Select value={String(hour)} onChange={(e) => setHour(Number(e.target.value))} className="max-w-[10rem]">
        {[6, 7, 8, 9, 10, 11, 12].map((h) => (
          <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
        ))}
      </Select>

      <div className="flex items-end gap-2 mt-4">
        <div className="flex-1">
          <label className="label">Chat de Telegram (chat-id)</label>
          <input className="input" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder={botConfigured ? "123456789" : "No disponible en este servidor"} disabled={!botConfigured} />
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setChatId("")} disabled={!botConfigured}>Quitar</Button>
      </div>

      {!botConfigured && (
        <p className="text-xs text-faint mt-2">Telegram no está configurado en este servidor. Crea el bot con @BotFather y añade TELEGRAM_BOT_TOKEN en el .env.</p>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testNow()} disabled={testing}>{testing ? <Spinner /> : <Send className="w-4 h-4" />} Probar</Button>
      </div>
    </Section>
  );
}