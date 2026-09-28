/**
 * The three states a person can pick for the chat, plus the one the server
 * adds on its own when nobody is there to see the pick.
 */
export const CHAT_STATUSES = ["ONLINE", "AWAY", "BUSY"] as const;
export type ChatStatus = (typeof CHAT_STATUSES)[number];
export type ChatPresence = ChatStatus | "OFFLINE";

export const STATUS_META: Record<ChatPresence, { label: string; hint: string; dot: string }> = {
  ONLINE: { label: "En línea", hint: "Todo suena con normalidad", dot: "bg-ok" },
  AWAY: { label: "Ausente", hint: "Sigues sonando, pero se ve que no estás", dot: "bg-warn" },
  BUSY: { label: "No disponible", hint: "Sin sonidos ni zumbidos", dot: "bg-danger" },
  OFFLINE: { label: "Desconectado", hint: "Sin ninguna sesión abierta", dot: "bg-faint" },
};

export function parseChatStatus(raw: string | null | undefined): ChatStatus {
  return (CHAT_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as ChatStatus) : "ONLINE";
}

export function parseChatPresence(raw: string | null | undefined): ChatPresence {
  return raw === "OFFLINE" ? "OFFLINE" : parseChatStatus(raw);
}

/** "No disponible" is the one that silences this device. */
export function isQuietStatus(status: ChatStatus): boolean {
  return status === "BUSY";
}
