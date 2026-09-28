import { useEffect, useState } from "react";
import { Ban, ShieldOff, Trash2 } from "lucide-react";
import { Avatar, Button, Modal } from "@/components/ui";
import { NickText, SubnickText } from "@/components/NickText";
import { StatusDot } from "@/components/chat/StatusDot";
import { PhotoZoom } from "@/components/chat/PhotoZoom";
import { STATUS_META, parseChatPresence } from "@/lib/chatStatus";
import type { ChatLink } from "@/lib/types";

/**
 * A friend's card, the twin of the group's one: the photo big, their nick with
 * its colours, their line, and what you can do about the friendship.
 *
 * Nothing here is editable — somebody else's photo and name are theirs — so the
 * card only reads. Blocking and unfriending stay with the page, which already
 * owns those mutations and their confirmation.
 */
export function FriendProfileDialog({ link, onClose, onBlock, onUnblock, onRemove }: {
  link: ChatLink | null;
  onClose: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onRemove: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => { setZoomed(false); }, [link?.linkId]);

  const person = link?.user;
  const photo = person?.avatarUrl ?? null;
  const nick = person?.nick?.trim() || "";
  const presence = STATUS_META[parseChatPresence(person?.status)];

  return (
    <>
      <Modal
        open={!!link}
        onClose={onClose}
        title="El perfil"
        size="sm"
        footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
      >
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <span className="relative">
              {photo ? (
                <button
                  type="button"
                  onClick={() => setZoomed(true)}
                  className="block rounded-full"
                  aria-label="Ver la foto a tamaño completo"
                >
                  <Avatar name={person?.name ?? ""} src={photo} size={132} />
                </button>
              ) : (
                <Avatar name={person?.name ?? ""} src={null} size={132} />
              )}
              <StatusDot status={person?.status} size={20} />
            </span>

            <div className="min-w-0 text-center">
              <NickText
                name={person?.name ?? ""}
                nick={person?.nick}
                segments={person?.nickSegments}
                color={person?.nickColor}
                bold={person?.nickBold}
                className="block truncate text-lg font-semibold"
              />
              {/* The account name is what mail and recovery use, so it is worth
                  showing when a nick hides it. */}
              {nick && nick !== person?.name && (
                <p className="truncate text-xs text-faint">Se llama {person?.name}</p>
              )}
              <SubnickText subnick={person?.subnick} className="mt-0.5 block truncate text-xs" />
              <p className="mt-1 text-xs text-muted">{presence.label}</p>
            </div>
          </div>

          <div className="rounded-xl border border-border">
            {link?.blockedByMe ? (
              <button
                type="button"
                onClick={onUnblock}
                className="flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left text-sm text-text transition-colors last:border-b-0 hover:bg-bg"
              >
                <ShieldOff className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                Desbloquear
              </button>
            ) : (
              <button
                type="button"
                onClick={onBlock}
                className="flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left text-sm text-text transition-colors last:border-b-0 hover:bg-bg"
              >
                <Ban className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                Bloquear
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-danger transition-colors hover:bg-bg"
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Eliminar amistad
            </button>
          </div>
          <p className="text-[11px] text-faint">
            {link?.blockedByMe
              ? "Mientras esté bloqueado no te escribe ni ve si estás en línea."
              : "Al bloquear dejas de recibir sus mensajes; para él desapareces de su lista."}
          </p>
        </div>
      </Modal>

      {zoomed && photo && (
        <PhotoZoom src={photo} alt={nick || person?.name || "Foto"} onClose={() => setZoomed(false)} />
      )}
    </>
  );
}
