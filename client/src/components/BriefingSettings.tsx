import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Sunrise } from "lucide-react";
import { http } from "@/lib/api";
import { Button, Select, Spinner, Toggle, useToast } from "@/components/ui";

type BriefingSettingsData = { enabled: boolean; hour: number; telegramReady: boolean };

const HOURS = [5, 6, 7, 8, 9, 10, 11, 12];
const QUERY_KEY = ["briefing-settings"];

/** Morning summary from Calen: bell + push, and Telegram when the user's bot is linked. */
export function BriefingSettings() {
  const { push } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => http.get<{ settings: BriefingSettingsData }>("/api/briefing/settings"),
  });
  const [testing, setTesting] = useState(false);
  const s = data?.settings;

  const save = async (patch: Partial<Pick<BriefingSettingsData, "enabled" | "hour">>) => {
    try {
      const r = await http.patch<{ settings: BriefingSettingsData }>("/api/briefing/settings", patch);
      qc.setQueryData(QUERY_KEY, r);
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar el resumen.");
    }
  };

  const testNow = async () => {
    setTesting(true);
    try {
      const r = await http.post<{ telegram: boolean }>("/api/briefing/test");
      push("success", r.telegram ? "Resumen enviado: mira la campana, el aviso y Telegram." : "Resumen enviado: mira la campana y el aviso.");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo enviar la prueba.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="border-t border-border/70 pt-5">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-text">
        <Sunrise className="h-4 w-4 text-accent" aria-hidden="true" />Resumen matinal
      </h3>
      <p className="mb-3 text-xs leading-relaxed text-faint">Cada mañana Calen te resume atrasadas, eventos, tareas, hábitos y el tiempo de tu ciudad, a la hora que elijas.</p>
      {isLoading || !s ? <Spinner /> : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-border/70">
            <Toggle label="Enviarme el resumen cada mañana" on={s.enabled} set={(enabled) => void save({ enabled })} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <Select label="Hora" value={String(s.hour)} onChange={(e) => void save({ hour: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </Select>
            </div>
            <Button variant="secondary" onClick={() => void testNow()} disabled={testing}>
              {testing ? <Spinner size={16} /> : <Send className="h-4 w-4" aria-hidden="true" />}Probar ahora
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-faint">
            {s.telegramReady
              ? "También te llegará por Telegram, a tu bot vinculado."
              : <>Para recibirlo también por Telegram, conecta tu bot en <Link to="/settings#integrations" className="text-accent underline-offset-2 hover:underline">Integraciones</Link>.</>}
          </p>
        </div>
      )}
    </div>
  );
}
