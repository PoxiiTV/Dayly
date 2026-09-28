import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronDown,
  Clock,
  Globe,
  CircleHelp,
  Maximize2,
  MessagesSquare,
  Minimize2,
  Monitor,
  Palette,
  PawPrint,
  Plug,
  RectangleHorizontal,
  Settings2,
  Smartphone,
  Square,
  PaintBucket,
  Sun,
  Moon,
  Volume2,
} from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme, useThemeWave, useScheduleWave } from "@/lib/theme";
import { useContentWidth } from "@/lib/contentWidth";
import { setPaintCardsByProject, usePaintCardsByProject } from "@/lib/taskCardFill";
import { setUrgentPulsePref, useUrgentPulsePref } from "@/lib/urgentPulse";
import { BACKGROUND_VISIBILITY_DEFAULT, setBackgroundVisibility, useBackgroundVisibility } from "@/lib/backgroundVisibility";
import { Button, Input, Select, Spinner, useToast, PageHeader, Toggle } from "@/components/ui";
import { BriefingSettings } from "@/components/BriefingSettings";
import { enableWebPush } from "@/lib/AlertEngine";
import type { Mailbox, Theme } from "@/lib/types";
import { MascotSettings } from "@/components/MascotSettings";
import { setAiAssistPref, useAiAssistPref } from "@/lib/ai";
import { BrowserSettings } from "@/components/BrowserSettings";
import { ChatAudioSettings, ChatSettingsCore, ChatSettingsProvider } from "@/components/chat/ChatSettings";
import { VisualizerSettings } from "@/components/VisualizerSettings";
import { WallpaperPicker } from "@/components/WallpaperPicker";
import { SkinPicker } from "@/components/SkinPicker";
import { IntegrationsSettings } from "@/components/settings/IntegrationsSettings";
import { minutesFromTimeInput, timeInputFromMinutes } from "@/lib/themeSchedule";
import { NOTIFY_SOUNDS, parseNotifySound, playNotifySound } from "@/lib/notifySounds";
import { SETTINGS_GROUPS, settingsSectionFromHash, toggleSettingsSection, type SettingsSectionId } from "@/lib/settingsSections";

const SECTION_META: Record<SettingsSectionId, { title: string; summary: string; icon: typeof Settings2 }> = {
  general: { title: "General", summary: "Idioma, zona horaria, calendario y clima", icon: Settings2 },
  appearance: { title: "Apariencia", summary: "Tema, fondo, skin y ancho del panel", icon: Palette },
  sound: { title: "Sonido y avisos", summary: "Notificaciones, tonos, chat y visualizador", icon: Bell },
  chat: { title: "Chat", summary: "Identidad, estado, privacidad y diseño", icon: MessagesSquare },
  mascot: { title: "Mascota", summary: "Personaje, visibilidad, chat y proveedor de IA", icon: PawPrint },
  browser: { title: "Navegador", summary: "Comportamiento de enlaces y navegación", icon: Globe },
  integrations: { title: "Integraciones", summary: "Servicios conectados a tu cuenta", icon: Plug },
};

export function Settings() {
  const { user, applyTheme, applyThemeSchedule, applyNotifySound, applyNotifySoundEnabled } = useAuth();
  const { theme, schedule } = useTheme();
  const themeWave = useThemeWave();
  const scheduleWave = useScheduleWave();
  const { width: contentWidth, setWidth: setContentWidth } = useContentWidth();
  const paintCardsByProject = usePaintCardsByProject();
  const urgentPulse = useUrgentPulsePref();
  const backgroundVisibility = useBackgroundVisibility();
  const aiAssist = useAiAssistPref();
  const { push } = useToast();
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [openSection, setOpenSection] = useState<SettingsSectionId | null>(() => location.hash ? settingsSectionFromHash(location.hash) : null);

  const [tz, setTz] = useState(user?.timezone ?? "Europe/Madrid");
  const [weatherCity, setWeatherCity] = useState(user?.weatherCity ?? "");
  const [lang, setLang] = useState(user?.language ?? "es");
  const [fow, setFow] = useState(user?.firstDayOfWeek ?? 1);
  const [fmt24, setFmt24] = useState(user?.timeFormat24 ?? true);
  const [notifR, setNotifR] = useState(user?.notifyReminders ?? true);
  const [notifE, setNotifE] = useState(user?.notifyEvents ?? true);
  const [notifT, setNotifT] = useState(user?.notifyTasks ?? true);
  const [notifEmail, setNotifEmail] = useState(user?.notifyEmail ?? false);
  const [generalBusy, setGeneralBusy] = useState(false);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const { data: mailboxData } = useQuery({
    queryKey: ["inbox-mailboxes"],
    queryFn: () => http.get<{ mailboxes: Mailbox[] }>("/api/inbox/mailboxes"),
  });
  const defaultMailbox = mailboxData?.mailboxes.find((mailbox) => mailbox.isDefault) ?? null;
  const emailAlertsAvailable = Boolean(defaultMailbox && !defaultMailbox.lastError);

  useEffect(() => {
    if (mailboxData && !emailAlertsAvailable) setNotifEmail(false);
  }, [emailAlertsAvailable, mailboxData]);

  useEffect(() => {
    const section = location.hash ? settingsSectionFromHash(location.hash) : null;
    setOpenSection(section);
    if (!section) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`settings-section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  const toggle = (section: SettingsSectionId) => {
    const next = toggleSettingsSection(openSection, section);
    setOpenSection(next);
    navigate(next
      ? { pathname: location.pathname, search: location.search, hash: next }
      : { pathname: location.pathname, search: location.search });
  };

  const saveGeneralPrefs = async () => {
    setGeneralBusy(true);
    try {
      await http.patch("/api/users/me/preferences", {
        timezone: tz,
        weatherCity: weatherCity.trim() || null,
        language: lang,
        firstDayOfWeek: fow,
        timeFormat24: fmt24,
      });
      void qc.invalidateQueries();
      push("success", "Preferencias guardadas");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudieron guardar las preferencias.");
    } finally {
      setGeneralBusy(false);
    }
  };

  const saveNotificationPrefs = async () => {
    setNotificationsBusy(true);
    try {
      await http.patch("/api/users/me/preferences", {
        notifyReminders: notifR,
        notifyEvents: notifE,
        notifyTasks: notifT,
        notifyEmail: notifEmail,
      });
      void qc.invalidateQueries();
      push("success", "Avisos guardados");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudieron guardar los avisos.");
    } finally {
      setNotificationsBusy(false);
    }
  };

  const changeTheme = (nextTheme: Theme, event?: React.SyntheticEvent) => {
    themeWave(nextTheme, event);
    void applyTheme(nextTheme);
  };

  const changeSchedule = (startMin: number, endMin: number, event?: React.SyntheticEvent) => {
    const next = { enabled: true, startMin, endMin };
    scheduleWave(next, event);
    void applyThemeSchedule(next);
  };

  if (!user) return null;

  const content: Record<SettingsSectionId, ReactNode> = {
    general: (
      <div>
        <div className="modal-grid">
          <Select label="Zona horaria" value={tz} onChange={(e) => setTz(e.target.value)}>
            {["Europe/Madrid", "Europe/London", "America/New_York", "America/Mexico_City", "UTC"].map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </Select>
          <Select label="Idioma" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="es">Español</option><option value="en">English</option>
          </Select>
          <Select label="Primer día de la semana" value={fow} onChange={(e) => setFow(Number(e.target.value))}>
            <option value={1}>Lunes</option><option value={0}>Domingo</option>
          </Select>
          <Select label="Formato de hora" value={fmt24 ? "24" : "12"} onChange={(e) => setFmt24(e.target.value === "24")}>
            <option value="24">24 horas</option><option value="12">12 horas</option>
          </Select>
          <Input label="Ciudad para el clima" value={weatherCity} onChange={(e) => setWeatherCity(e.target.value)} placeholder="Vacío = ciudad de la zona horaria" />
        </div>
        <Button className="mt-4" size="sm" onClick={() => void saveGeneralPrefs()} disabled={generalBusy}>
          {generalBusy ? <Spinner /> : "Guardar preferencias"}
        </Button>
      </div>
    ),
    appearance: (
      <div>
        <p className="mb-2 text-xs font-medium text-muted">Tema</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {([["LIGHT", "Claro", Sun], ["DARK", "Oscuro", Moon], ["SYSTEM", "Sistema", Smartphone]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" onClick={(e) => changeTheme(value, e)} className={clsx("inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-1.5 text-xs font-medium transition-all", !schedule.enabled && theme === value ? "border-accent bg-accent-soft text-accent-strong" : "border-border text-muted hover:bg-surface")}>
              <Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label}</span>
            </button>
          ))}
          <button type="button" onClick={(e) => changeSchedule(schedule.startMin, schedule.endMin, e)} className={clsx("inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-1.5 text-xs font-medium transition-all", schedule.enabled ? "border-accent bg-accent-soft text-accent-strong" : "border-border text-muted hover:bg-surface")}>
            <Clock className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Horario</span>
          </button>
        </div>
        {schedule.enabled && (
          <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface p-3">
            <p className="text-xs text-muted">Tema oscuro en este intervalo; el resto del día usa el claro. Si cruza medianoche, también vale.</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Oscuro desde" type="time" value={timeInputFromMinutes(schedule.startMin)} onChange={(e) => changeSchedule(minutesFromTimeInput(e.target.value, schedule.startMin), schedule.endMin)} />
              <Input label="Hasta" type="time" value={timeInputFromMinutes(schedule.endMin)} onChange={(e) => changeSchedule(schedule.startMin, minutesFromTimeInput(e.target.value, schedule.endMin))} />
            </div>
          </div>
        )}
        <SkinPicker />
        <WallpaperPicker
          aside={(
            <div className="flex flex-col justify-center gap-1.5 rounded-xl border border-border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="background-visibility" className="text-sm font-medium text-text">Intensidad</label>
                <span className="flex items-center gap-2 text-xs">
                  {backgroundVisibility !== BACKGROUND_VISIBILITY_DEFAULT && (
                    <button type="button" onClick={() => setBackgroundVisibility(BACKGROUND_VISIBILITY_DEFAULT)} className="font-medium text-accent hover:underline">
                      Restablecer
                    </button>
                  )}
                  <span className="w-9 text-right font-semibold tabular-nums text-text" aria-hidden="true">{backgroundVisibility} %</span>
                </span>
              </div>
              <input
                id="background-visibility"
                type="range"
                min={0}
                max={100}
                step={5}
                value={backgroundVisibility}
                onChange={(e) => setBackgroundVisibility(Number(e.target.value))}
                aria-valuetext={`${backgroundVisibility} %`}
                className="range-slim"
                style={{ "--range-fill": `${backgroundVisibility}%` } as React.CSSProperties}
              />
              <p className="text-[11px] text-faint">Bájala si el fondo distrae.</p>
            </div>
          )}
        />
        <p className="mb-2 mt-5 text-xs font-medium text-muted">Tarjetas de tareas</p>
        <div className="grid grid-cols-2 gap-1.5 sm:max-w-md">
          {([[false, "Solo el borde", Square], [true, "Color del proyecto", PaintBucket]] as const).map(([value, label, Icon]) => (
            <button key={label} type="button" onClick={() => setPaintCardsByProject(value)} aria-pressed={paintCardsByProject === value} className={clsx("inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-1.5 text-xs font-medium transition-colors duration-150", paintCardsByProject === value ? "border-accent bg-accent-soft text-accent-strong" : "border-border text-muted hover:border-accent/40 hover:text-text")}>
              <Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-faint">El texto se adapta al fondo para leerse bien. Con clic derecho sobre una tarjeta puedes cambiar su color o eliminarla.</p>
        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 sm:max-w-md">
          <Toggle label="Marco rojo pulsante en urgentes que vencen en menos de 2 h" on={urgentPulse} set={setUrgentPulsePref} />
        </div>
        <p className="mb-2 mt-5 text-xs font-medium text-muted">Ancho del panel</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {([["compact", "Compacto", Minimize2], ["normal", "Estrecho", Square], ["wide", "Normal", RectangleHorizontal], ["full", "Ancho", Maximize2]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" onClick={() => setContentWidth(value)} aria-pressed={contentWidth === value} className={clsx("inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-1.5 text-xs font-medium transition-colors duration-150", contentWidth === value ? "border-accent bg-accent-soft text-accent-strong" : "border-border text-muted hover:border-accent/40 hover:text-text")}>
              <Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>
    ),
    sound: (
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-text">Avisos</h3>
          <div className="overflow-hidden rounded-xl border border-border/70 divide-y divide-border/70">
            <Toggle label="Recordatorios" on={notifR} set={setNotifR} />
            <Toggle label="Avisos de eventos" on={notifE} set={setNotifE} />
            <Toggle label="Tareas con hora de inicio" on={notifT} set={setNotifT} />
            <Toggle label="Enviar avisos con el buzón predeterminado" on={notifEmail} set={setNotifEmail} disabled={!emailAlertsAvailable} />
            <Toggle label="Sonido de aviso" on={user.notifySoundEnabled !== false} set={(on) => void applyNotifySoundEnabled(on)} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-faint">Solo se avisan automáticamente las tareas que tienen una hora de inicio. Las tareas sin hora no generan avisos; para ellas puedes crear un recordatorio.</p>
          {!emailAlertsAvailable && mailboxData && (
            <p className="mt-2 text-xs text-warn">{defaultMailbox ? "Prueba o vuelve a conectar el buzón predeterminado para activar estos avisos." : "Conecta y elige un buzón predeterminado desde Correo para activar estos avisos."}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void saveNotificationPrefs()} disabled={notificationsBusy}>{notificationsBusy ? <Spinner /> : "Guardar avisos"}</Button>
            <Button size="sm" variant="secondary" disabled={pushBusy} onClick={async () => {
              if (pushBusy) return;
              setPushBusy(true);
              try {
                const result = await enableWebPush();
                push(result.ok ? "success" : "error", result.detail);
              } catch (e: unknown) {
                push("error", e instanceof Error ? e.message : "No se pudo activar el push.");
              } finally {
                setPushBusy(false);
              }
            }}>{pushBusy ? <Spinner /> : "Activar avisos del sistema"}</Button>
          </div>
        </div>
        <div className="space-y-6 lg:border-l lg:border-border/70 lg:pl-8">
          <div className={clsx(user.notifySoundEnabled === false && "opacity-50")}>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted"><Volume2 className="h-3.5 w-3.5" />Tono de aviso</p>
            <p className="mb-2 text-xs text-faint">Suena en la app y en el navegador. Telegram usa el suyo.</p>
            <div className="grid grid-cols-2 gap-2">
              {NOTIFY_SOUNDS.map((sound) => {
                const selected = parseNotifySound(user.notifySound) === sound.id;
                return (
                  <button key={sound.id} type="button" onClick={() => { playNotifySound(sound.id, { preview: true }); void applyNotifySound(sound.id); }} aria-pressed={selected} className={clsx("flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-all", selected ? "border-accent bg-accent-soft text-accent-strong" : "border-border text-muted hover:bg-surface")}>
                    <span className="text-xs font-medium">{sound.name}</span><span className="text-[11px] leading-snug text-faint">{sound.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-t border-border/70 pt-5">
            <h3 className="mb-3 text-sm font-semibold text-text">Chat</h3>
            <ChatAudioSettings />
          </div>
          <div className="border-t border-border/70 pt-1">
            <VisualizerSettings />
          </div>
        </div>
      </div>
    ),
    chat: <ChatSettingsCore />,
    mascot: (
      <div className="space-y-4">
        <div>
          <div className="overflow-hidden rounded-xl border border-border/70">
            <Toggle label="Usar la IA en tareas" on={aiAssist} set={setAiAssistPref} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-faint">Con el proveedor de abajo: títulos claros al crear, mejorar descripciones, sugerir subtareas y clasificación, reprogramar atrasadas y plan del día. Solo se envía el texto de la tarea.</p>
        </div>
        <MascotSettings />
        <BriefingSettings />
      </div>
    ),
    browser: <BrowserSettings />,
    integrations: <IntegrationsSettings />,
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Ajustes"
        lead="Personaliza Dayly a tu manera. Todo en un solo lugar."
        actions={(
          <Link to="/help" className="btn-secondary btn-sm inline-flex items-center gap-2" aria-label="Abrir ayuda">
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
            <span>Ayuda</span>
          </Link>
        )}
      />
      <ChatSettingsProvider>
        <div className="space-y-7">
          {SETTINGS_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`settings-group-${group.id}`}>
              <h2 id={`settings-group-${group.id}`} className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">{group.label}</h2>
              <div className="card overflow-hidden divide-y divide-border">
                {group.sections.map((section) => {
                  const meta = SECTION_META[section];
                  return (
                    <AccordionSection key={section} id={section} title={meta.title} summary={meta.summary} icon={<meta.icon className="h-4 w-4" />} active={openSection === section} onToggle={() => toggle(section)}>
                      {content[section]}
                    </AccordionSection>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </ChatSettingsProvider>
    </div>
  );
}

function AccordionSection({ id, title, summary, icon, active, onToggle, children }: { id: SettingsSectionId; title: string; summary: string; icon: ReactNode; active: boolean; onToggle: () => void; children: ReactNode }) {
  const buttonId = `settings-button-${id}`;
  const panelId = `settings-panel-${id}`;
  return (
    <section id={`settings-section-${id}`} className="scroll-mt-5">
      <button
        id={buttonId}
        type="button"
        aria-expanded={active}
        aria-controls={panelId}
        onClick={onToggle}
        className={clsx(
          "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset sm:px-5",
          active ? "bg-accent-soft/70" : "hover:bg-surface/80",
        )}
      >
        <span className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", active ? "bg-accent text-white" : "bg-surface text-muted")}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={clsx("block text-sm font-semibold", active ? "text-accent-strong" : "text-text")}>{title}</span>
          <span className="block truncate text-xs text-faint">{summary}</span>
        </span>
        <ChevronDown className={clsx("h-4 w-4 shrink-0 text-faint transition-transform", active && "rotate-180 text-accent-strong")} aria-hidden="true" />
      </button>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!active} className="border-t border-border/70 px-4 py-5 sm:px-5 sm:py-6">
        {children}
      </div>
    </section>
  );
}
