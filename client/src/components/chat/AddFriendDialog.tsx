import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import { http } from "@/lib/api";
import { Button, Input, Modal, Segmented, Spinner, useToast } from "@/components/ui";
import type { ChatIdentity } from "@/lib/types";

type Mode = "code" | "email";

export function AddFriendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [mode, setMode] = useState<Mode>("code");
  const [value, setValue] = useState("");

  const identity = useQuery({
    queryKey: ["chat-identity"],
    queryFn: () => http.get<ChatIdentity>("/api/chat/me"),
    enabled: open,
  });

  const request = useMutation({
    mutationFn: () => http.post<{ autoAccepted?: boolean; message?: string }>(
      "/api/chat/requests",
      mode === "code" ? { code: value.trim() } : { email: value.trim() },
    ),
    onSuccess: (data) => {
      setValue("");
      void qc.invalidateQueries({ queryKey: ["chat-friends"] });
      push("success", data.autoAccepted
        ? "¡Ya sois amigos! Os habíais invitado a la vez."
        : data.message ?? "Solicitud enviada.");
      onClose();
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo enviar la solicitud."),
  });

  const rotate = useMutation({
    mutationFn: () => http.post<{ friendCode: string }>("/api/chat/friend-code/rotate"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat-identity"] });
      push("success", "Código nuevo. El anterior ya no sirve.");
    },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo cambiar el código."),
  });

  const copy = async () => {
    if (!identity.data) return;
    try {
      await navigator.clipboard.writeText(identity.data.friendCode);
      push("success", "Código copiado");
    } catch {
      push("error", "No se pudo copiar");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Añadir amigo"
      description="Comparte tu código o invita por correo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => request.mutate()} disabled={!value.trim() || request.isPending}>
            {request.isPending ? "Enviando…" : "Enviar solicitud"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-bg p-3">
          <p className="text-xs font-medium text-muted">Tu código de amigo</p>
          <div className="mt-1 flex items-center gap-2">
            {identity.isLoading ? <Spinner size={16} /> : (
              <code className="flex-1 truncate text-lg font-semibold tracking-widest text-text">
                {identity.data?.friendCode}
              </code>
            )}
            <Button variant="ghost" icon onClick={() => void copy()} aria-label="Copiar código" title="Copiar">
              <Copy className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              icon
              onClick={() => rotate.mutate()}
              disabled={rotate.isPending}
              aria-label="Cambiar código"
              title="Cambiar código"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-faint">
            Cambiarlo invalida el anterior, pero conserva tus amistades.
          </p>
        </div>

        <Segmented
          value={mode}
          onChange={(next) => { setMode(next); setValue(""); }}
          options={[{ value: "code", label: "Por código" }, { value: "email", label: "Por correo" }]}
        />
        {mode === "code" ? (
          <Input
            label="Código de tu amigo"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="XXXXX-XXXXX"
            autoFocus
          />
        ) : (
          <>
            <Input
              label="Correo"
              type="email"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="nombre@correo.com"
              autoFocus
            />
            <p className="text-xs text-faint">
              Por privacidad, la respuesta es la misma exista o no esa cuenta.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
