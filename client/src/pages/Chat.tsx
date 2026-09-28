import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, Ban, UserRound, ChevronsLeft, ChevronsRight, Eraser, Image as ImageIcon, LogOut, MessagesSquare, MoreVertical, Pencil, Search, ShieldOff, Trash2, UserPlus, Users, Volume2, VolumeX } from "lucide-react";
import { http } from "@/lib/api";
import { NickText } from "@/components/NickText";
import { typingLabel, useTypingNames } from "@/lib/chatTyping";
import { useAuth } from "@/lib/auth";
import { Avatar, Button, ConfirmDialog, EmptyState, Input, Spinner, useToast } from "@/components/ui";
import { fmtTime, relativeDay } from "@/lib/dates";
import { AddFriendDialog } from "@/components/chat/AddFriendDialog";
import { AddMembersDialog, GroupProfileDialog, NewGroupDialog, RenameGroupDialog } from "@/components/chat/GroupDialogs";
import { FriendProfileDialog } from "@/components/chat/FriendProfileDialog";
import { ChatThread, ChatTextSizeControls, useChatTextScale } from "@/components/chat/ChatThread";
import { ChatWallpaperPicker } from "@/components/chat/ChatWallpaperPicker";
import { ChatMediaPanel } from "@/components/chat/ChatMediaPanel";
import { StatusDot } from "@/components/chat/StatusDot";
import { CHAT_STATUSES, parseChatStatus, STATUS_META } from "@/lib/chatStatus";
import { type Conversation } from "@/lib/chatConversation";
import { CHAT_FRIENDS_QUERY_KEY, CHAT_GROUPS_QUERY_KEY, conversationKey, useChatConversations, useChatIdentity } from "@/lib/chatConversations";
import { useFloatingChat } from "@/lib/FloatingChat";
import { chatWallpaperBackground, findChatWallpaper } from "@/lib/chatWallpapers";
import { useTheme } from "@/lib/theme";
import type { ChatGif, ChatGroup, ChatLink } from "@/lib/types";

/** Hour for today, day name for anything older: the usual chat list stamp. */
function stamp(when: string | Date | null | undefined): string {
  if (!when) return "";
  const date = new Date(when);
  const day = relativeDay(date);
  return day === "Hoy" ? fmtTime(date) : day;
}

/** Last line of the conversation, marked when it was us who wrote it. */
function preview(conv: { lastMessage: string | null; lastMessageMine: boolean | null }): string {
  if (!conv.lastMessage) return "Sin mensajes";
  return conv.lastMessageMine ? `Tú: ${conv.lastMessage}` : conv.lastMessage;
}

const MEDIA_PANEL_KEY = "dayly.chat.mediaPanel";
const LIST_FOLDED_KEY = "dayly.chat.listFolded";

/** The last message, or who is writing right now if somebody is. */
function ConversationPreview({ conv }: { conv: Conversation }) {
  const typing = typingLabel(useTypingNames(conv.id));
  if (typing) return <span className="font-medium text-accent">{typing}</span>;
  return <>{preview(conv)}</>;
}

export function Chat() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activate, active: floatingChatActive } = useFloatingChat();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ChatLink | null>(null);
  const textScale = useChatTextScale();
  const [papersOpen, setPapersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [clearing, setClearing] = useState<Conversation | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [inviting, setInviting] = useState<ChatGroup | null>(null);
  const [renaming, setRenaming] = useState<ChatGroup | null>(null);
  // Held by id, not by value: adding or removing someone has to be visible in
  // the card that is open, and the list is what the query keeps fresh.
  const [profileId, setProfileId] = useState<string | null>(null);
  /** Same idea for a friend's card: blocking has to show without reopening it. */
  const [friendProfileId, setFriendProfileId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<ChatGroup | null>(null);
  // Remembered: leaving the page and coming back should not close a panel the
  // user deliberately opened.
  const [mediaOpen, setMediaOpen] = useState(() => {
    try { return localStorage.getItem(MEDIA_PANEL_KEY) === "1"; } catch { return false; }
  });
  // Folded list: only the faces, and only from tablet up — on a phone the list
  // is the whole screen and there is nothing to fold it out of the way of.
  const [listFolded, setListFolded] = useState(() => {
    try { return localStorage.getItem(LIST_FOLDED_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(LIST_FOLDED_KEY, listFolded ? "1" : "0"); } catch { /* private mode */ }
  }, [listFolded]);
  useEffect(() => {
    try { localStorage.setItem(MEDIA_PANEL_KEY, mediaOpen ? "1" : "0"); } catch { /* private mode */ }
  }, [mediaOpen]);
  const insertRef = useRef<((text: string) => void) | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  /**
   * On a phone the picker sits where the conversation is, so sending has to
   * give it back. On a desktop it is a column of its own and stays put.
   */
  const closeOnPhone = () => {
    if (window.matchMedia("(max-width: 767px)").matches) setMediaOpen(false);
  };
  const sendGifRef = useRef<((gif: ChatGif) => void) | null>(null);
  const identity = useChatIdentity();
  const { resolved } = useTheme();
  const myStatus = parseChatStatus(identity.data?.status);

  /** Both kinds answer at the same paths under their own base. */
  const prefsPath = (conv: Conversation) => (conv.kind === "group"
    ? `/api/chat/groups/${conv.id}/prefs`
    : `/api/chat/friends/${conv.id}/prefs`);
  const wallpaperPath = (conv: Conversation) => (conv.kind === "group"
    ? `/api/chat/groups/${conv.id}/wallpaper`
    : `/api/chat/friends/${conv.id}/wallpaper`);
  const clearPath = (conv: Conversation) => (conv.kind === "group"
    ? `/api/chat/groups/${conv.id}/clear`
    : `/api/chat/friends/${conv.id}/clear`);
  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: CHAT_FRIENDS_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: CHAT_GROUPS_QUERY_KEY });
  };

  const setMuted = useMutation({
    mutationFn: ({ conv, muted }: { conv: Conversation; muted: boolean }) =>
      http.patch(prefsPath(conv), { muted }),
    onSuccess: (_data, variables) => {
      setMenuOpen(false);
      refreshLists();
      push("success", variables.muted ? "Conversación silenciada" : "Conversación con sonido");
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo guardar."),
  });

  const clearThread = useMutation({
    mutationFn: (conv: Conversation) => http.post(clearPath(conv)),
    onSuccess: (_data, conv) => {
      setClearing(null);
      setMenuOpen(false);
      void qc.invalidateQueries({ queryKey: ["chat-thread", conv.id] });
      refreshLists();
      push("success", "Conversación limpiada");
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo limpiar."),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => http.patch("/api/chat/settings", { status }),
    onSuccess: () => {
      setStatusOpen(false);
      void qc.invalidateQueries({ queryKey: ["chat-identity"] });
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo cambiar el estado."),
  });

  const setWallpaper = useMutation({
    mutationFn: ({ conv, wallpaper }: { conv: Conversation; wallpaper: string | null }) =>
      http.patch(wallpaperPath(conv), { wallpaper }),
    onSuccess: () => {
      setPapersOpen(false);
      refreshLists();
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo cambiar el fondo."),
  });

  const { friends, groups, incoming, outgoing, conversations, isLoading } = useChatConversations();
  /** The card reads the live group, so it updates when its people change. */
  const profileGroup = groups.find((group) => group.groupId === profileId) ?? null;
  const selectedId = params.get("t");
  const selectedGroupId = params.get("g");
  const friendProfile = friends.find((link) => link.linkId === friendProfileId) ?? null;
  const selected = conversations.find((conv) => (
    conv.kind === "group" ? conv.id === selectedGroupId : conv.id === selectedId
  )) ?? null;
  const selectedLink = selected?.link ?? null;
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? conversations.filter((conv) => conv.title.toLowerCase().includes(needle))
    : conversations;
  const paper = findChatWallpaper(selected?.wallpaper);

  // A thread that disappeared (removed, blocked, left) must not leave a dead
  // panel behind it.
  useEffect(() => {
    const asked = selectedId ?? selectedGroupId;
    const settled = !isLoading;
    if (asked && settled && !selected) setParams({}, { replace: true });
  }, [selectedId, selectedGroupId, selected, isLoading, setParams]);

  const act = useMutation({
    mutationFn: ({ path }: { path: string; ok: string }) => http.post(path),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: CHAT_FRIENDS_QUERY_KEY });
      push("success", variables.ok);
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo completar."),
  });

  const leaveGroup = useMutation({
    mutationFn: (group: ChatGroup) => http.del(`/api/chat/groups/${group.groupId}/members/${user?.id ?? ""}`),
    onSuccess: () => {
      setLeaving(null);
      setParams({}, { replace: true });
      void qc.invalidateQueries({ queryKey: CHAT_GROUPS_QUERY_KEY });
      push("success", "Has salido del grupo");
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo salir."),
  });

  const remove = useMutation({
    mutationFn: (linkId: string) => http.del(`/api/chat/friends/${linkId}`),
    onSuccess: () => {
      setRemoving(null);
      setParams({}, { replace: true });
      void qc.invalidateQueries({ queryKey: CHAT_FRIENDS_QUERY_KEY });
      push("success", "Amistad eliminada");
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo eliminar."),
  });

  const threadMenu = selected ? (
    <div className="relative shrink-0">
      <Button
        variant="ghost"
        size="sm"
        icon
        onClick={() => setMenuOpen((was) => !was)}
        aria-expanded={menuOpen}
        aria-label="Opciones de la conversación"
        title="Opciones"
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </Button>
      {menuOpen && (
        <>
          {/* A bare overlay closes it on the next click, wherever it lands. */}
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-pop"
          >
            {/* Everything the conversation can do lives here now, phone and
                desktop alike: no toolbar row stealing height from it. */}
            <div className="flex items-center justify-between gap-2 py-1 pl-3 pr-1">
              <span className="text-sm text-text">Tamaño del texto</span>
              <ChatTextSizeControls {...textScale} />
            </div>
            <MenuItem
              icon={<MessagesSquare className="h-4 w-4 text-muted" aria-hidden="true" />}
              onClick={() => { setMenuOpen(false); activate(conversationKey(selected)); }}
            >
              {floatingChatActive ? "Actualizar burbuja" : "Abrir como burbuja"}
            </MenuItem>
            <MenuItem icon={<ImageIcon className="h-4 w-4 text-muted" aria-hidden="true" />} onClick={() => { setMenuOpen(false); setPapersOpen(true); }}>
              Fondo de la conversación
            </MenuItem>
            <div className="my-1 border-t border-border" />

            <MenuItem
              icon={selected.muted
                ? <Volume2 className="h-4 w-4 text-muted" aria-hidden="true" />
                : <VolumeX className="h-4 w-4 text-muted" aria-hidden="true" />}
              onClick={() => setMuted.mutate({ conv: selected, muted: !selected.muted })}
            >
              {selected.muted ? "Activar sonido" : "Silenciar conversación"}
            </MenuItem>
            <MenuItem
              icon={<Eraser className="h-4 w-4 text-muted" aria-hidden="true" />}
              onClick={() => { setMenuOpen(false); setClearing(selected); }}
            >
              Limpiar conversación
            </MenuItem>

            <div className="my-1 border-t border-border" />
            {selected.kind === "group" ? (
              <>
                <MenuItem
                  icon={<UserPlus className="h-4 w-4 text-muted" aria-hidden="true" />}
                  onClick={() => { setMenuOpen(false); setInviting(selected.group ?? null); }}
                >
                  Añadir participantes
                </MenuItem>
                {/* Photo and members live in the card; renaming stays with the owner. */}
                <MenuItem
                  icon={<Users className="h-4 w-4 text-muted" aria-hidden="true" />}
                  onClick={() => { setMenuOpen(false); setProfileId(selected.group?.groupId ?? null); }}
                >
                  Ver el grupo y su gente
                </MenuItem>
                {selected.group?.isOwner && (
                  <MenuItem
                    icon={<Pencil className="h-4 w-4 text-muted" aria-hidden="true" />}
                    onClick={() => { setMenuOpen(false); setRenaming(selected.group ?? null); }}
                  >
                    Cambiar el nombre
                  </MenuItem>
                )}
                <MenuItem
                  danger
                  icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => { setMenuOpen(false); setLeaving(selected.group ?? null); }}
                >
                  Salir del grupo
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem
                  icon={<UserRound className="h-4 w-4 text-muted" aria-hidden="true" />}
                  onClick={() => { setMenuOpen(false); setFriendProfileId(selected.id); }}
                >
                  Ver el perfil
                </MenuItem>
                {selectedLink?.blockedByMe ? (
                  <MenuItem
                    icon={<ShieldOff className="h-4 w-4 text-muted" aria-hidden="true" />}
                    onClick={() => { setMenuOpen(false); act.mutate({ path: `/api/chat/friends/${selected.id}/unblock`, ok: "Desbloqueado" }); }}
                  >
                    Desbloquear
                  </MenuItem>
                ) : (
                  <MenuItem
                    icon={<Ban className="h-4 w-4 text-muted" aria-hidden="true" />}
                    onClick={() => { setMenuOpen(false); act.mutate({ path: `/api/chat/friends/${selected.id}/block`, ok: "Bloqueado" }); }}
                  >
                    Bloquear
                  </MenuItem>
                )}
                <MenuItem
                  danger
                  icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => { setMenuOpen(false); setRemoving(selectedLink); }}
                >
                  Eliminar amistad
                </MenuItem>
              </>
            )}
          </div>
        </>
      )}
      {/* The swatches hang from this same button: it is the only place the
          background can be changed from. */}
      <ChatWallpaperPicker
        open={papersOpen}
        align="right"
        below
        current={selected.wallpaper ?? null}
        onClose={() => setPapersOpen(false)}
        onPick={(wallpaper) => setWallpaper.mutate({ conv: selected, wallpaper })}
      />
    </div>
  ) : null;

  return (
    /* No page header anywhere: the whole screen is the conversation, and
       adding a friend is the button at the top of the list. The wide class
       only means something in the compact shape, where the block has an edge
       to grow from. */
    <div className={clsx("page-shell chat-page", mediaOpen && selected && "chat-page-wide")}>
      {/* The row has to be an explicit 1fr: with auto rows the panel grows with
          the conversation on a phone and pushes the composer off the screen. */}
      <div className={clsx(
        "chat-shell card grid grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden",
        // The picker is a column of the block, so it covers nothing.
        mediaOpen && selected
          ? (listFolded ? "md:grid-cols-[5rem_minmax(0,1fr)_22rem]" : "md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_22rem]")
          : (listFolded ? "md:grid-cols-[5rem_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"),
      )}>
        <aside className={clsx("relative flex min-w-0 min-h-0 flex-col border-border bg-surface md:border-r", selected && "hidden md:flex")}>
          {/* Same height and padding as the conversation header, so your face
              and the other person's sit on the same line and the two dividers
              meet. The search box gets its own block underneath. */}
          <div className={clsx(
            "flex shrink-0 items-center gap-2 border-b border-border px-2 py-2 md:py-3",
            // Folded, your face stays — centred in the rail, and still the
            // thing that keeps this header the same height as the
            // conversation's, so both faces sit on one line.
            listFolded && "md:justify-center md:px-1",
          )}>
            {/* Your own row doubles as the state picker: the face you already
                look at is where the bead lives. */}
            <div className={clsx("relative min-w-0 flex-1", listFolded && "md:flex-none")}>
              <button
                type="button"
                onClick={() => setStatusOpen((was) => !was)}
                aria-expanded={statusOpen}
                aria-label={`Tu estado: ${STATUS_META[myStatus].label}`}
                title={`${STATUS_META[myStatus].label} · cambiar`}
                className={clsx(
                  // No vertical padding: this row's height has to be exactly
                  // the avatar's, or it stops matching the conversation header.
                  "flex w-full min-w-0 items-center gap-2 rounded-xl text-left transition-colors hover:bg-bg",
                  listFolded ? "md:px-0" : "px-1",
                )}
              >
                <span className="relative shrink-0">
                  <Avatar name={user?.name ?? ""} src={user?.avatarUrl ?? null} size={38} />
                  <StatusDot status={myStatus} />
                </span>
                <span className={clsx("min-w-0 flex-1", listFolded && "md:hidden")}>
                  <span className="block truncate text-sm font-semibold text-text">{user?.name}</span>
                  <span className="block truncate text-[11px] text-muted">{STATUS_META[myStatus].label}</span>
                </span>
              </button>
              {statusOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setStatusOpen(false)} aria-hidden />
                  <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-pop">
                    {CHAT_STATUSES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={myStatus === value}
                        onClick={() => setStatus.mutate(value)}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg"
                      >
                        <span className={clsx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", STATUS_META[value].dot)} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className={clsx("block text-sm", myStatus === value ? "font-semibold text-accent-strong" : "text-text")}>
                            {STATUS_META[value].label}
                          </span>
                          <span className="block text-[11px] leading-snug text-muted">{STATUS_META[value].hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          {/* Halfway down the column's own edge, straddling the divider: the
              place a panel splitter lives, out of the way of both the faces
              above it and the conversation beside it. */}
          <button
            type="button"
            onClick={() => setListFolded((was) => !was)}
            aria-expanded={!listFolded}
            aria-label={listFolded ? "Desplegar la lista de chats" : "Plegar la lista de chats"}
            title={listFolded ? "Desplegar la lista" : "Plegar la lista"}
            className="absolute right-0 top-1/2 z-20 hidden h-6 w-6 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border border-border bg-surface text-muted shadow-soft transition-colors hover:border-accent/40 hover:text-text md:grid"
          >
            {listFolded
              ? <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
              : <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          <div className={clsx("shrink-0 border-b border-border p-2", listFolded && "md:hidden")}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
              <Input
                dense
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar conversación…"
                aria-label="Buscar conversación"
              />
            </div>
          </div>
          {isLoading ? (
            <div className="grid h-full place-items-center py-10 text-accent"><Spinner /></div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              {incoming.length > 0 && (
                /* No folded shape for these: the unread badge in the menu and
                   the tab bar still counts them, and unfolding is one click. */
                <section className={clsx("mb-2", listFolded && "md:hidden")}>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                    Solicitudes ({incoming.length})
                  </p>
                  {incoming.map((request) => (
                    <div key={request.linkId} className="flex items-center gap-2 rounded-xl px-2 py-2">
                      <Avatar name={request.user.name} src={request.user.avatarUrl} size={32} />
                      <span className="min-w-0 flex-1 truncate text-sm text-text">{request.user.name}</span>
                      <Button
                        size="sm"
                        onClick={() => act.mutate({ path: `/api/chat/requests/${request.linkId}/accept`, ok: "Solicitud aceptada" })}
                      >
                        Aceptar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => act.mutate({ path: `/api/chat/requests/${request.linkId}/decline`, ok: "Solicitud rechazada" })}
                        aria-label={`Rechazar a ${request.user.name}`}
                      >
                        <Ban className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </section>
              )}

              {/* Sticky, so the column always says what it is even halfway down
                  a long list. Adding a friend is this section's action. */}
              <div className={clsx(
                "sticky top-0 z-10 -mx-2 mb-0.5 flex items-center gap-2 bg-surface px-3 py-1",
                listFolded && "md:hidden",
              )}>
                <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                  Chats{conversations.length > 0 ? ` (${conversations.length})` : ""}
                </p>
                <Button variant="ghost" size="sm" icon onClick={() => setCreatingGroup(true)} title="Nuevo grupo" aria-label="Nuevo grupo">
                  <Users className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" icon onClick={() => setAdding(true)} title="Añadir amigo" aria-label="Añadir amigo">
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>

              {conversations.length === 0 && incoming.length === 0 && outgoing.length === 0 ? (
                <div className={clsx(listFolded && "md:hidden")}>
                  <EmptyState
                    icon={<MessagesSquare className="h-8 w-8" />}
                    title="Todavía no tienes amigos aquí"
                    hint="Comparte tu código y empieza a hablar."
                    action={<Button onClick={() => setAdding(true)}>Añadir amigo</Button>}
                  />
                </div>
              ) : (
                shown.map((conv) => (
                  <button
                    key={`${conv.kind}:${conv.id}`}
                    type="button"
                    onClick={() => setParams(conv.kind === "group" ? { g: conv.id } : { t: conv.id })}
                    title={listFolded ? conv.title : undefined}
                    className={clsx(
                      "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors",
                      // Unfolded, the handle's lane on the edge stays clear;
                      // folded, the rail is wide enough that a centred face
                      // never reaches it, so the padding stays even.
                      !listFolded && "md:pr-3",
                      listFolded && "md:justify-center md:px-1",
                      selected?.kind === conv.kind && selected?.id === conv.id ? "bg-accent-soft" : "hover:bg-bg",
                    )}
                  >
                    <span className="relative shrink-0">
                      <Avatar name={conv.title} src={conv.avatarUrl} size={40} />
                      {conv.kind === "group" ? (
                        <span className="absolute -bottom-0.5 -right-0.5 grid h-[15px] w-[15px] place-items-center rounded-full bg-accent text-white ring-2 ring-surface">
                          <Users className="h-2.5 w-2.5" aria-hidden="true" />
                        </span>
                      ) : (
                        <StatusDot status={conv.status} />
                      )}
                      {/* Folded there is no room for the counter, so it becomes
                          a dot on the face. Never on a phone, which never folds. */}
                      {listFolded && conv.unreadCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 hidden h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-white md:grid">
                          {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                        </span>
                      )}
                    </span>
                    <span className={clsx("min-w-0 flex-1", listFolded && "md:hidden")}>
                      <span className="flex items-baseline gap-2">
                        <NickText
                          name={conv.title}
                          color={conv.titleColor}
                          segments={conv.titleSegments}
                          bold={conv.titleBold}
                          className="min-w-0 flex-1 truncate text-sm font-medium text-text"
                        />
                        <span className="shrink-0 text-[11px] tabular-nums text-faint">{stamp(conv.lastMessageAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={clsx(
                          "min-w-0 flex-1 truncate text-[12px]",
                          conv.unreadCount > 0 ? "font-medium text-text" : "text-muted",
                        )}>
                          {conv.link?.blockedByMe ? "Bloqueado" : <ConversationPreview conv={conv} />}
                        </span>
                        {conv.unreadCount > 0 && (
                          <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                            {conv.unreadCount}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                ))
              )}

              {conversations.length > 0 && shown.length === 0 && (
                <p className={clsx("px-2 py-6 text-center text-sm text-faint", listFolded && "md:hidden")}>Ninguna conversación coincide.</p>
              )}

              {outgoing.length > 0 && (
                <section className={clsx("mt-2 border-t border-border pt-2", listFolded && "md:hidden")}>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Enviadas</p>
                  {outgoing.map((request) => (
                    <div key={request.linkId} className="flex items-center gap-2 rounded-xl px-2 py-2">
                      <Avatar name={request.user.name} src={request.user.avatarUrl} size={28} />
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">{request.user.name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => act.mutate({ path: `/api/chat/requests/${request.linkId}/cancel`, ok: "Solicitud cancelada" })}
                      >
                        Cancelar
                      </Button>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
        </aside>

        <section
          className={clsx("min-w-0 min-h-0", (!selected || mediaOpen) && "hidden md:block")}
          style={paper ? { background: chatWallpaperBackground(paper, resolved === "dark") } : undefined}
        >
          {selected && user ? (
            <div ref={threadRef} className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                <ChatThread
                  conv={selected}
                  meId={user.id}
                  textScale={textScale.scale}
                  gifsAvailable={identity.data?.gifsAvailable ?? false}
                  // On a phone the conversation header carries the way back:
                  // a row of its own for it was a row less of messages.
                  leading={(
                    <>
                      <Button variant="ghost" size="sm" icon className="md:hidden" onClick={() => setParams({})} aria-label="Volver a la lista">
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        className="hidden md:grid"
                        onClick={() => activate(conversationKey(selected))}
                        aria-label={floatingChatActive ? "Actualizar burbuja del chat" : "Abrir chat como burbuja"}
                        title={floatingChatActive ? "Actualizar burbuja" : "Abrir como burbuja"}
                        aria-pressed={floatingChatActive}
                      >
                        <MessagesSquare className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                  menu={threadMenu}
                  mediaOpen={mediaOpen}
                  onToggleMedia={() => setMediaOpen((was) => !was)}
                  insertRef={insertRef}
                  sendGifRef={sendGifRef}
                  // Both kinds open their card from the same place.
                  onAvatarClick={selected.kind === "group"
                    ? (selected.group ? () => setProfileId(selected.group!.groupId) : undefined)
                    : () => setFriendProfileId(selected.id)}
                />
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center p-8">
              <p className="text-sm text-faint">Elige una conversación.</p>
            </div>
          )}
        </section>

        {mediaOpen && selected && (
          <ChatMediaPanel
            id="chat-media-panel"
            className="row-start-1 col-start-1 md:col-start-3"
            onPick={(emoji) => { insertRef.current?.(emoji); closeOnPhone(); }}
            onSendGif={(gif) => {
              sendGifRef.current?.(gif);
              closeOnPhone();
              if (!window.matchMedia("(max-width: 767px)").matches) {
                threadRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
              }
            }}
            gifsAvailable={identity.data?.gifsAvailable ?? false}
            onClose={() => setMediaOpen(false)}
          />
        )}
      </div>

      <AddFriendDialog open={adding} onClose={() => setAdding(false)} />
      <NewGroupDialog
        open={creatingGroup}
        onClose={() => setCreatingGroup(false)}
        friends={friends.filter((friend) => friend.status === "ACCEPTED")}
        onCreated={(group) => setParams({ g: group.groupId })}
      />
      <AddMembersDialog
        group={inviting}
        onClose={() => setInviting(null)}
        friends={friends.filter((friend) => friend.status === "ACCEPTED")}
      />
      <RenameGroupDialog group={renaming} onClose={() => setRenaming(null)} />
      <FriendProfileDialog
        link={friendProfile}
        onClose={() => setFriendProfileId(null)}
        onBlock={() => friendProfile && act.mutate({ path: `/api/chat/friends/${friendProfile.linkId}/block`, ok: "Bloqueado" })}
        onUnblock={() => friendProfile && act.mutate({ path: `/api/chat/friends/${friendProfile.linkId}/unblock`, ok: "Desbloqueado" })}
        // The confirmation belongs to the page; the card steps aside for it.
        onRemove={() => { setRemoving(friendProfile); setFriendProfileId(null); }}
      />
      <GroupProfileDialog
        group={profileGroup}
        meId={user?.id ?? ""}
        friendLinks={[...friends, ...incoming, ...outgoing]}
        onClose={() => setProfileId(null)}
        // One dialog at a time: the card steps aside for the one it opens.
        onAddMembers={() => { setInviting(profileGroup); setProfileId(null); }}
        onRename={() => { setRenaming(profileGroup); setProfileId(null); }}
      />
      <ConfirmDialog
        open={!!leaving}
        onClose={() => setLeaving(null)}
        onConfirm={() => leaving && leaveGroup.mutate(leaving)}
        title="Salir del grupo"
        message={`Dejarás de recibir los mensajes de ${leaving?.name ?? ""}. Los demás siguen hablando sin ti.`}
        busy={leaveGroup.isPending}
      />
      <ConfirmDialog
        open={!!clearing}
        onClose={() => setClearing(null)}
        onConfirm={() => clearing && clearThread.mutate(clearing)}
        title="Limpiar conversación"
        message={`Dejarás de ver los mensajes anteriores de ${clearing?.title ?? ""}. Los demás conservan los suyos.`}
        busy={clearThread.isPending}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.linkId)}
        title="Eliminar amistad"
        message={`Se borrará la conversación con ${removing?.user.name ?? ""} para los dos. No se puede deshacer.`}
        busy={remove.isPending}
      />
    </div>
  );
}

/** One line of the conversation menu, so the list reads as a list. */
function MenuItem({ icon, onClick, danger, children }: {
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-bg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        danger ? "text-danger" : "text-text",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
