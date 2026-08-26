import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Avatar, Button, Input, useToast, Spinner, PageHeader } from "@/components/ui";
import { http } from "@/lib/api";
import { fileToAvatarDataUrl } from "@/lib/avatar";

export function Profile() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const { push } = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const save = async () => {
    setBusy(true);
    try {
      await http.patch("/api/users/me", { name: name.trim() });
      await refresh();
      qc.invalidateQueries();
      push("success", "Perfil actualizado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar.");
    } finally { setBusy(false); }
  };

  const saveAvatar = async (avatarUrl: string | null) => {
    setPhotoBusy(true);
    try {
      await http.patch("/api/users/me", { avatarUrl });
      await refresh();
      qc.invalidateQueries();
      push("success", avatarUrl ? "Foto actualizada" : "Foto eliminada");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo cambiar la foto.");
    } finally { setPhotoBusy(false); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    try {
      const avatarUrl = await fileToAvatarDataUrl(file);
      await saveAvatar(avatarUrl);
    } catch (err: unknown) {
      setPhotoBusy(false);
      push("error", err instanceof Error ? err.message : "No se pudo leer la foto.");
    }
  };

  return (
    <div className="page-shell">
      <PageHeader title="Perfil" />
      <div className="space-y-6">
      <div className="card p-6 flex items-center gap-5">
        <div className="relative shrink-0">
          <Avatar name={user.name} src={user.avatarUrl} size={72} />
          <button
            type="button"
            disabled={photoBusy}
            onClick={() => fileRef.current?.click()}
            aria-label="Cambiar foto de perfil"
            className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-accent text-white grid place-items-center shadow-soft hover:bg-accent-strong disabled:opacity-50"
          >
            {photoBusy ? <Spinner className="!w-3.5 !h-3.5 !text-white" /> : <Camera className="w-3.5 h-3.5" />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={onFile}
          />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-text truncate">{user.name}</h2>
          <p className="text-sm text-muted truncate">{user.email}</p>
          <span className="chip mt-1.5 bg-accent-soft text-accent-strong">{user.roleName === "ADMIN" ? "Administrador" : "Usuario"}</span>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button type="button" size="sm" variant="secondary" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              Cambiar foto
            </Button>
            {user.avatarUrl && (
              <Button type="button" size="sm" variant="ghost" disabled={photoBusy} onClick={() => void saveAvatar(null)}>
                Quitar
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="card p-5">
        <label className="label">Nombre</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />
        <div className="flex gap-2 mt-3">
          <Button onClick={save} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button>
        </div>
      </div>
      </div>
    </div>
  );
}
