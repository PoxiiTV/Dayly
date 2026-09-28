import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, Maximize2, PanelTop } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CHAT_SIDEBAR_EVENT, MASCOT_SIDEBAR_EVENT } from "@/lib/navOrder";
import { Button, Checkbox, Select, Spinner, useToast } from "@/components/ui";
import { CHAT_SOUNDS, CHAT_SOUND_OFF, parseChatSound, playChatSound } from "@/lib/chatSounds";
import { useChatLayout, type ChatLayout } from "@/lib/chatLayout";
import { CHAT_STATUSES, parseChatStatus, STATUS_META } from "@/lib/chatStatus";
import type { ChatIdentity } from "@/lib/types";

type ChatPatch = Partial<Pick<ChatIdentity, "discoverableByEmail" | "buzzEnabled" | "sound" | "status">>;
type ChatSettingsContextValue = {
  data: ChatIdentity | undefined;
  isLoading: boolean;
  update: (patch: ChatPatch) => void;
};

const ChatSettingsContext = createContext<ChatSettingsContextValue | null>(null);

export function ChatSettingsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["chat-identity"],
    queryFn: () => http.get<ChatIdentity>("/api/chat/me"),
  });
  const mutation = useMutation({
    mutationFn: (patch: ChatPatch) => http.patch("/api/chat/settings", patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["chat-identity"] }),
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo guardar."),
  });

  return (
    <ChatSettingsContext.Provider value={{ data, isLoading, update: mutation.mutate }}>
      {children}
    </ChatSettingsContext.Provider>
  );
}

function useChatSettings() {
  const context = useContext(ChatSettingsContext);
  if (!context) throw new Error("Chat settings must be rendered inside ChatSettingsProvider");
  return context;
}

export function ChatAudioSettings() {
  const { data, update } = useChatSettings();
  return (
    <div className="space-y-4">
      <Checkbox
        label="Permitir zumbidos (la ventana tiembla)"
        checked={data?.buzzEnabled ?? true}
        onChange={(buzzEnabled) => update({ buzzEnabled })}
      />
      <div>
        <Select
          label="Sonido de los mensajes"
          dense
          value={parseChatSound(data?.sound)}
          onChange={(event) => {
            const sound = event.target.value;
            playChatSound(sound, { preview: true });
            update({ sound });
          }}
        >
          {CHAT_SOUNDS.map((sound) => (
            <option key={sound.id} value={sound.id}>{sound.name} — {sound.hint}</option>
          ))}
          <option value={CHAT_SOUND_OFF}>Sin sonido</option>
        </Select>
        <p className="mt-1 text-xs text-faint">Suena aunque la ventana no esté delante.</p>
      </div>
    </div>
  );
}

/** Friend code, presence, discoverability and local chat layout. */
export function ChatSettingsCore() {
  const { data, isLoading, update } = useChatSettings();
  const { layout, setLayout } = useChatLayout();
  const { user, refresh } = useAuth();
  const { push } = useToast();
  const [sidebarEnabled, setSidebarEnabled] = useState(() => user?.navLayout?.chatSidebar === true);
  const [sidebarBusy, setSidebarBusy] = useState(false);

  useEffect(() => {
    setSidebarEnabled(user?.navLayout?.chatSidebar === true);
  }, [user?.id, user?.navLayout?.chatSidebar]);

  const toggleSidebar = async () => {
    if (!user || sidebarBusy) return;
    const next = !sidebarEnabled;
    const previousLayout = user.navLayout ?? {};
    setSidebarBusy(true);
    setSidebarEnabled(next);
    window.dispatchEvent(new CustomEvent(CHAT_SIDEBAR_EVENT, { detail: next }));
    if (next) window.dispatchEvent(new CustomEvent(MASCOT_SIDEBAR_EVENT, { detail: false }));
    try {
      await http.patch("/api/users/me/preferences", {
        navLayout: {
          ...previousLayout,
          chatSidebar: next,
          ...(next ? { mascotSidebar: false } : {}),
        },
      });
      void refresh();
      push("success", next ? "Chat fijado a la izquierda" : "Chat izquierdo oculto");
    } catch (error) {
      setSidebarEnabled(!next);
      window.dispatchEvent(new CustomEvent(CHAT_SIDEBAR_EVENT, { detail: !next }));
      window.dispatchEvent(new CustomEvent(MASCOT_SIDEBAR_EVENT, { detail: previousLayout.mascotSidebar === true }));
      push("error", error instanceof Error ? error.message : "No se pudo actualizar el chat fijado.");
    } finally {
      setSidebarBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted">Tu código de amigo</p>
      <div className="flex items-center gap-2">
        {isLoading ? <Spinner size={16} /> : (
          <code className="text-sm font-semibold tracking-widest text-text">{data?.friendCode}</code>
        )}
        <Button
          variant="ghost"
          icon
          aria-label="Copiar código de amigo"
          title="Copiar"
          onClick={() => {
            if (!data) return;
            void navigator.clipboard.writeText(data.friendCode)
              .then(() => push("success", "Código copiado"))
              .catch(() => push("error", "No se pudo copiar"));
          }}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-muted">Tu estado</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {CHAT_STATUSES.map((value) => {
            const active = parseChatStatus(data?.status) === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => update({ status: value })}
                aria-pressed={active}
                title={STATUS_META[value].hint}
                className={clsx(
                  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-1.5 text-xs font-medium transition-colors duration-150",
                  active ? "border-accent bg-accent-soft text-accent-strong" : "border-border text-muted hover:border-accent/40 hover:text-text",
                )}
              >
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", STATUS_META[value].dot)} aria-hidden="true" />
                <span className="truncate">{STATUS_META[value].label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-faint">
          «No disponible» silencia los mensajes y los zumbidos en este equipo; los demás ven tu estado junto a tu nombre.
        </p>
      </div>
      <div className="mt-3">
        <Checkbox
          label="Permitir que me encuentren por mi correo"
          checked={data?.discoverableByEmail ?? true}
          onChange={(discoverableByEmail) => update({ discoverableByEmail })}
        />
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-muted">Tamaño del panel de chat</p>
        <div className="grid grid-cols-2 gap-1.5">
          {([["full", "Completa", Maximize2], ["compact", "Compacta", PanelTop]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setLayout(value as ChatLayout)}
              aria-pressed={layout === value}
              className={clsx(
                "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-1.5 text-xs font-medium transition-colors duration-150",
                layout === value ? "border-accent bg-accent-soft text-accent-strong" : "border-border text-muted hover:border-accent/40 hover:text-text",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{label}</span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-faint">
          Completa ocupa toda la ventana; compacta lo deja como una tarjeta dentro de la página. Se guarda en este dispositivo.
        </p>
      </div>
      <div className="mt-4 rounded-xl border border-border/70 bg-surface/40 p-3">
        <button
          type="button"
          role="switch"
          aria-checked={sidebarEnabled}
          aria-busy={sidebarBusy}
          disabled={!user || sidebarBusy}
          onClick={() => void toggleSidebar()}
          className="flex w-full items-center justify-between gap-4 text-left text-sm text-text transition-colors hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="min-w-0">
            <span className="block font-medium">Anclar chat al sidebar izquierdo</span>
            <span className="mt-0.5 block text-xs leading-5 text-faint">Responde rápidamente desde cualquier pantalla y elige la conversación arriba.</span>
          </span>
          <span aria-hidden="true" className={sidebarEnabled ? "relative h-5 w-9 shrink-0 rounded-full bg-accent" : "relative h-5 w-9 shrink-0 rounded-full bg-border"}>
            <span className={sidebarEnabled ? "absolute top-0.5 left-0.5 h-4 w-4 translate-x-[18px] rounded-full bg-white shadow-sm" : "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm"} />
          </span>
        </button>
        <p role="note" className="mt-2 text-xs leading-5 text-muted">
          El chat y la mascota fijados a la izquierda no son compatibles por espacio. Al activar uno, el otro se desactiva.
        </p>
      </div>
      <p className="mt-3 text-xs text-faint">
        Los mensajes se cifran en el servidor, pero quién habla con quién y cuándo no puede ocultarse.
      </p>
    </div>
  );
}

export function ChatSettings() {
  return (
    <ChatSettingsProvider>
      <ChatSettingsCore />
      <div className="mt-5 border-t border-border/70 pt-5">
        <ChatAudioSettings />
      </div>
    </ChatSettingsProvider>
  );
}
