import { useEffect, useState } from "react";
import { Sunrise, Send, Bot } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { Button, Select, Spinner, useToast, Section, Toggle } from "@/components/ui";

type B = {
  enabled: boolean;
  hour: number;
  telegramChatId: string | null;
  telegramBotConfigured: boolean;
};

export function BriefingSettings() {
  const { push } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["briefing-settings"],
    queryFn: () => http.get<{ settings: B }>("/api/briefing/settings"),
  });
  const s = data?.settings;

  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(8);
  const [chatId, setChatId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [hasBot, setHasBot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!s) return;
    setEnabled(s.enabled);
    setHour(s.hour);
    setChatId(s.telegramChatId ?? "");
    setHasBot(s.telegramBotConfigured);
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
      qc.setQueryData(["briefing-settings"], { settings: r.settings });
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

  const saveBot = async () => {
    if (!botToken.trim()) return;
    setBusy(true);
    try {
      const r = await http.patch<{ settings: B }>("/api/briefing/settings", { telegramBotToken: botToken.trim() });
      qc.setQueryData(["briefing-settings"], { settings: r.settings });
      setHasBot(true);
      setBotToken("");
      push("success", "Bot de Telegram conectado");
    } catch (e: any) {
      push("error", e?.message ?? "Token inválido.");
    } finally {
      setBusy(false);
    }
  };

  const removeBot = async () => {
    setBusy(true);
    try {
      const r = await http.patch<{ settings: B }>("/api/briefing/settings", { clearTelegramBot: true });
      qc.setQueryData(["briefing-settings"], { settings: r.settings });
      setHasBot(false);
      push("success", "Bot desconectado");
    } catch {
      push("error", "No se pudo desconectar el bot.");
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

      <div className="border-t border-border mt-5 pt-4">
        <p className="text-sm font-medium text-text flex items-center gap-2"><Bot className="w-4 h-4" /> Bot de Telegram (solo tuyo)</p>
        <p className="text-xs text-muted mt-1 mb-3">Crea tu bot con @BotFather, copia el token y pégalo aquí. Se guarda cifrado en tu cuenta; cada usuario puede usar el suyo.</p>
        {hasBot ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-ok font-medium"><span className="w-2 h-2 rounded-full bg-ok" /> Conectado</span>
            <Button size="sm" variant="ghost" onClick={() => void removeBot()} disabled={busy}>Desconectar</Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label">Token del bot (de @BotFather)</label>
              <input className="input" type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="1234567890:AA..." />
            </div>
            <Button size="sm" onClick={() => void saveBot()} disabled={busy || !botToken.trim()}>{busy ? <Spinner /> : "Conectar"}</Button>
          </div>
        )}
      </div>

      <div className="border-t border-border mt-5 pt-4">
        <label className="label">Chat de Telegram (chat-id)</label>
        <input className="input max-w-[18rem]" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789" disabled={!hasBot} />
        {!hasBot && <p className="text-xs text-faint mt-2">Conecta primero tu bot para poner el chat-id.</p>}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testNow()} disabled={testing}>{testing ? <Spinner /> : <Send className="w-4 h-4" />} Probar</Button>
      </div>
    </Section>
  );
}