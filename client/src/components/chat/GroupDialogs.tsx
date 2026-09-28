import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Camera, Check, Crown, Pencil, Trash2, UserMinus, UserPlus, Wand2, X } from "lucide-react";
import { http } from "@/lib/api";
import { Avatar, Button, Input, Modal, Spinner, useToast } from "@/components/ui";
import { fileToAvatarDataUrl } from "@/lib/avatar";
import { NickDecorator } from "@/components/NickDecorator";
import { NickColorPicker } from "@/components/NickColorPicker";
import { NickField } from "@/components/NickField";
import { NickText } from "@/components/NickText";
import { PhotoZoom } from "@/components/chat/PhotoZoom";
import { GROUP_NAME_MAX } from "@/lib/nickStyles";
import {
  segmentsLength, segmentsToText, textToSegments, type NickSegment,
} from "@/lib/nickSegments";
import type { ChatGroup, ChatLink } from "@/lib/types";

/** The friend picker both dialogs share: a list of faces you tick. */
function FriendPicker({ friends, picked, onToggle }: {
  friends: ChatLink[];
  picked: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (friends.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-faint">No te queda nadie por añadir.</p>;
  }
  return (
    <div className="max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-border">
      {friends.map((friend) => {
        const on = picked.has(friend.user.id);
        return (
          <button
            key={friend.user.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(friend.user.id)}
            className={clsx(
              "flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0",
              on ? "bg-accent-soft" : "hover:bg-bg",
            )}
          >
            <Avatar name={friend.user.name} src={friend.user.avatarUrl} size={32} />
            <span className="min-w-0 flex-1 truncate text-sm text-text">{friend.user.name}</span>
            <span className={clsx(
              "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
              on ? "border-accent bg-accent text-white" : "border-border text-transparent",
            )}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Name it, tick the people, and the conversation exists. */
export function NewGroupDialog({ open, onClose, friends, onCreated }: {
  open: boolean;
  onClose: () => void;
  friends: ChatLink[];
  onCreated: (group: ChatGroup) => void;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) { setName(""); setPicked(new Set()); }
  }, [open]);

  const create = useMutation({
    mutationFn: () => http.post<{ group: ChatGroup }>("/api/chat/groups", {
      name: name.trim(),
      memberIds: [...picked],
    }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["chat-groups"] });
      push("success", "Grupo creado");
      onCreated(data.group);
      onClose();
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo crear el grupo."),
  });

  const toggle = (id: string) => setPicked((was) => {
    const next = new Set(was);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo grupo"
      description="Ponle nombre y elige con quién hablas."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!name.trim() || picked.size === 0 || create.isPending}
          >
            {create.isPending ? "Creando…" : "Crear grupo"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nombre del grupo"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder="Cena del sábado"
        />
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">
            Participantes {picked.size > 0 && `(${picked.size})`}
          </p>
          <FriendPicker friends={friends} picked={picked} onToggle={toggle} />
          <p className="mt-1 text-[11px] text-faint">Solo aparecen tus amigos aceptados.</p>
        </div>
      </div>
    </Modal>
  );
}

/** More people for a conversation that already exists. */
export function AddMembersDialog({ group, onClose, friends }: {
  group: ChatGroup | null;
  onClose: () => void;
  friends: ChatLink[];
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => { setPicked(new Set()); }, [group?.groupId]);

  const add = useMutation({
    mutationFn: () => http.post(`/api/chat/groups/${group!.groupId}/members`, { userIds: [...picked] }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat-groups"] });
      push("success", picked.size === 1 ? "Participante añadido" : "Participantes añadidos");
      onClose();
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo añadir."),
  });

  const present = new Set(group?.members.map((member) => member.id) ?? []);
  const available = friends.filter((friend) => !present.has(friend.user.id));

  return (
    <Modal
      open={!!group}
      onClose={onClose}
      title="Añadir participantes"
      description={group ? `${group.name} · ${group.members.length} ahora mismo` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => add.mutate()} disabled={picked.size === 0 || add.isPending}>
            {add.isPending ? "Añadiendo…" : "Añadir"}
          </Button>
        </>
      }
    >
      <FriendPicker
        friends={available}
        picked={picked}
        onToggle={(id) => setPicked((was) => {
          const next = new Set(was);
          if (!next.delete(id)) next.add(id);
          return next;
        })}
      />
    </Modal>
  );
}

/**
 * The group's card: the photo at a size worth looking at, who is in it, and the
 * two things you come here to do — bring somebody in, or take somebody out.
 *
 * The photo is deliberately open to every participant, the way the messengers
 * people already use behave; the server records who changed it. Taking others
 * out stays with whoever created the group, and the server enforces both.
 */
export function GroupProfileDialog({ group, meId, friendLinks, onClose, onAddMembers, onRename }: {
  group: ChatGroup | null;
  meId: string;
  friendLinks: ChatLink[];
  onClose: () => void;
  onAddMembers: () => void;
  onRename: () => void;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  /** Two-step removal in the row itself: a second modal over this one is worse. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => { setConfirming(null); setZoomed(false); }, [group?.groupId]);

  const savePhoto = async (avatarUrl: string | null) => {
    if (!group) return;
    setBusy(true);
    try {
      await http.patch(`/api/chat/groups/${group.groupId}/photo`, { avatarUrl });
      await qc.invalidateQueries({ queryKey: ["chat-groups"] });
      push("success", avatarUrl ? "Foto del grupo cambiada" : "Foto del grupo quitada");
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo cambiar la foto.");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      // Cropped and compressed in the browser, same as a profile photo, so the
      // request stays well under the server's cap.
      await savePhoto(await fileToAvatarDataUrl(file));
    } catch (error) {
      push("error", error instanceof Error ? error.message : "No se pudo procesar la imagen.");
      setBusy(false);
    }
  };

  const remove = useMutation({
    mutationFn: (userId: string) => http.del(`/api/chat/groups/${group!.groupId}/members/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat-groups"] });
      push("success", "Participante fuera del grupo");
      setConfirming(null);
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo sacar a esa persona."),
  });

  const requestFriend = useMutation({
    mutationFn: (targetId: string) => http.post<{ autoAccepted: boolean }>(
      `/api/chat/groups/${group!.groupId}/friend-requests`,
      { userId: targetId },
    ),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["chat-friends"] });
      push("success", result.autoAccepted ? "Ahora sois amigos" : "Solicitud de amistad enviada");
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo enviar la solicitud."),
  });

  const members = group?.members ?? [];
  const photo = group?.avatarUrl ?? null;

  return (
    <>
      <Modal
        open={!!group}
        onClose={onClose}
        title="El grupo"
        size="sm"
        footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
      >
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            {photo ? (
              <button
                type="button"
                onClick={() => setZoomed(true)}
                className="rounded-full"
                aria-label="Ver la foto a tamaño completo"
              >
                <Avatar name={group?.name ?? ""} src={photo} size={132} />
              </button>
            ) : (
              <Avatar name={group?.name ?? ""} src={null} size={132} />
            )}
            <div className="min-w-0 text-center">
              <NickText
                name={group?.name ?? ""}
                segments={group?.nameSegments ?? null}
                className="block truncate text-lg font-semibold"
              />
              <p className="text-xs text-muted">
                {members.length} {members.length === 1 ? "participante" : "participantes"}
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => void onFile(event)}
            />
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? <Spinner /> : <><Camera className="h-4 w-4" />{photo ? "Cambiar foto" : "Poner foto"}</>}
              </Button>
              {photo && (
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void savePhoto(null)}>
                  <Trash2 className="h-4 w-4" />Quitar
                </Button>
              )}
              {group?.isOwner && (
                <Button type="button" size="sm" variant="ghost" onClick={onRename}>
                  <Pencil className="h-4 w-4" />Nombre
                </Button>
              )}
            </div>
            <p className="text-center text-xs text-faint">La foto la puede cambiar cualquiera del grupo.</p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted">Participantes</p>
              <button type="button" onClick={onAddMembers} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />Añadir
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-border">
              {members.map((member) => {
                const isOwner = member.id === group?.ownerId;
                const friendLink = friendLinks.find((link) => link.user.id === member.id);
                const requestBusy = requestFriend.isPending && requestFriend.variables === member.id;
                const incomingRequest = friendLink?.status === "PENDING" && !friendLink.requestedByMe;
                // Leaving is the menu's job; this button is for taking others out.
                const canRemove = Boolean(group?.isOwner) && !isOwner && member.id !== meId;
                return (
                  <div key={member.id} className="flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0">
                    <Avatar name={member.name} src={member.avatarUrl} size={32} />
                    <span className="min-w-0 flex-1 truncate text-sm text-text">
                      <NickText
                        name={member.name}
                        nick={member.nick}
                        segments={member.nickSegments}
                        color={member.nickColor}
                        bold={member.nickBold}
                      />
                      {member.id === meId && <span className="ml-1 text-xs text-faint">(tú)</span>}
                    </span>
                    {isOwner && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-faint">
                        <Crown className="h-3.5 w-3.5" aria-hidden="true" />Creador
                      </span>
                    )}
                    {member.id !== meId && (friendLink?.status === "ACCEPTED" ? (
                      <span className="shrink-0 text-[11px] text-faint">Amigos</span>
                    ) : friendLink?.status === "PENDING" && !incomingRequest ? (
                      <span className="shrink-0 text-[11px] text-faint">Solicitud enviada</span>
                    ) : friendLink?.status === "BLOCKED" ? (
                      <span className="shrink-0 text-[11px] text-faint">No disponible</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={requestFriend.isPending}
                        onClick={() => requestFriend.mutate(member.id)}
                        className="min-h-11 shrink-0 whitespace-nowrap px-2.5"
                        aria-label={incomingRequest ? `Aceptar la solicitud de ${member.name}` : `Pedir amistad a ${member.name}`}
                        title={incomingRequest ? "Aceptar solicitud" : "Pedir amistad"}
                      >
                        {requestBusy ? <Spinner size={16} /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
                        {incomingRequest ? "Aceptar" : "Añadir"}
                      </Button>
                    ))}
                    {canRemove && (confirming === member.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(member.id)}
                        >
                          Sacar
                        </Button>
                        <Button size="sm" variant="ghost" icon aria-label="Cancelar" onClick={() => setConfirming(null)}>
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon
                        aria-label={`Sacar a ${member.name} del grupo`}
                        title="Sacar del grupo"
                        onClick={() => setConfirming(member.id)}
                      >
                        <UserMinus className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ))}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-faint">
              {group?.isOwner
                ? "Puedes sacar a cualquiera menos a ti: para eso está «Salir del grupo»."
                : "Solo quien creó el grupo puede sacar a alguien."}
            </p>
          </div>
        </div>
      </Modal>

      {zoomed && photo && (
        <PhotoZoom src={photo} alt={group?.name ?? "Foto del grupo"} onClose={() => setZoomed(false)} />
      )}
    </>
  );
}

export function RenameGroupDialog({ group, onClose }: { group: ChatGroup | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  /** The pieces are the truth; the plain name is derived from them. */
  const [pieces, setPieces] = useState<NickSegment[]>([]);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  /** The ornaments stay folded away: most renames are just a word. */
  const [decorating, setDecorating] = useState(false);

  useEffect(() => {
    setPieces(group?.nameSegments?.length ? group.nameSegments : textToSegments(group?.name ?? ""));
    setSelection(null);
    setDecorating(false);
  }, [group?.groupId, group?.name, group?.nameSegments]);

  const name = segmentsToText(pieces);
  const length = segmentsLength(pieces);
  const tooLong = length > GROUP_NAME_MAX;

  const rename = useMutation({
    mutationFn: () => http.patch(`/api/chat/groups/${group!.groupId}`, {
      name: name.trim(),
      // The server derives the plain name from the pieces and only stores them
      // when they actually differ in colour.
      nameSegments: pieces.length ? pieces : null,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat-groups"] });
      push("success", "Nombre cambiado");
      onClose();
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo cambiar el nombre."),
  });

  return (
    <Modal
      open={!!group}
      onClose={onClose}
      title="Nombre del grupo"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => rename.mutate()} disabled={!name.trim() || tooLong || rename.isPending}>
            {rename.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-bg px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-faint">Vista previa</p>
          <NickText name={name || "Sin nombre"} segments={pieces} className="block truncate" />
        </div>

        <div className="space-y-1.5">
          <span className="label">Nombre</span>
          <NickField
            segments={pieces}
            onChange={setPieces}
            onSelection={setSelection}
            placeholder="Cuadrilla"
            ariaLabel="Nombre del grupo"
          />
          <div className="flex items-center justify-between gap-2">
            <p className={clsx("text-xs", tooLong ? "text-danger" : "text-faint")}>
              {length}/{GROUP_NAME_MAX} caracteres
            </p>
            <button
              type="button"
              onClick={() => setDecorating((v) => !v)}
              className="text-xs font-medium text-accent hover:underline inline-flex items-center gap-1"
            >
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
              {decorating ? "Ocultar adornos" : "Ponerle adornos"}
            </button>
          </div>
        </div>

        {decorating && (
          <NickColorPicker segments={pieces} onChange={setPieces} selection={selection} />
        )}

        {decorating && (
          <NickDecorator
            value={name}
            onChange={(next) => setPieces(textToSegments(next))}
            baseLabel="Nombre del grupo (para los adornos)"
            basePlaceholder="Cuadrilla"
          />
        )}
      </div>
    </Modal>
  );
}
