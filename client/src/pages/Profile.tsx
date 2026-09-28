import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Camera, LogOut, Wand2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Avatar, Button, Input, useToast, Spinner, PageHeader, Segmented } from "@/components/ui";
import { http } from "@/lib/api";
import { fileToAvatarDataUrl } from "@/lib/avatar";
import { AccountData, AccountSecurity } from "@/components/AccountSettings";
import { Stats } from "@/pages/Stats";
import { NickGenerator } from "@/components/NickGenerator";
import { NickText, SubnickText } from "@/components/NickText";

export function Profile() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "stats" ? "stats" : "profile";
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [nickOpen, setNickOpen] = useState(false);
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

  const saveNick = async (value: { nick: string | null; nickColor: string | null; nickBold: boolean; subnick: string | null; nickSegments?: { t: string; c?: string | null }[] | null }) => {
    setBusy(true);
    try {
      await http.patch("/api/users/me", value);
      await refresh();
      qc.invalidateQueries();
      push("success", value.nick || value.subnick ? "Nick actualizado" : "Nick quitado");
    } catch (e: unknown) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar.");
      throw e;
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
      <Segmented
        options={[{ value: "profile", label: "Perfil" }, { value: "stats", label: "Estadísticas" }]}
        value={tab}
        onChange={(v) => setParams(v === "stats" ? { tab: "stats" } : {}, { replace: true })}
        className="mb-5"
      />
      {tab === "stats" ? <Stats embedded /> : (
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
            {photoBusy ? <Spinner size={14} className="text-white" /> : <Camera className="w-3.5 h-3.5" />}
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
          <h2 className="text-xl font-bold text-text truncate">
            <NickText name={user.name} nick={user.nick} color={user.nickColor} segments={user.nickSegments} bold={user.nickBold} />
          </h2>
          <SubnickText subnick={user.subnick} />
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
      <div className="card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label mb-0">Nick y frase</p>
            <p className="text-xs text-muted mt-0.5">
              Lo que se ve en la aplicación y en el chat. Tu nombre de cuenta no cambia: sigue siendo el de los correos.
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => setNickOpen(true)}>
            <Wand2 className="w-4 h-4" />Generador
          </Button>
        </div>
        <div className="rounded-xl border border-border bg-bg px-3 py-2.5">
          {user.nick || user.subnick ? (
            <>
              <NickText name={user.name} nick={user.nick} color={user.nickColor} segments={user.nickSegments} bold={user.nickBold} className="block truncate" />
              <SubnickText subnick={user.subnick} />
            </>
          ) : (
            <p className="text-sm text-muted">Sin nick. Ahora se muestra «{user.name}».</p>
          )}
        </div>
        {(user.nick || user.subnick) && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void saveNick({ nick: null, nickColor: null, nickBold: false, subnick: null, nickSegments: null })}>
            Quitar nick y frase
          </Button>
        )}
      </div>

      <NickGenerator
        open={nickOpen}
        onClose={() => setNickOpen(false)}
        name={user.name}
        initial={{
          nick: user.nick ?? null,
          nickColor: user.nickColor ?? null,
          nickBold: Boolean(user.nickBold),
          subnick: user.subnick ?? null,
          nickSegments: user.nickSegments ?? null,
        }}
        onSave={saveNick}
      />

      <AccountSecurity />
      <AccountData />
      {/* Where leaving belongs: with the account, not in the menu you use to
          move around the app. */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">Cerrar sesión</p>
          <p className="text-xs text-muted">Saldrás en este dispositivo. Tus datos se quedan donde están.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="text-danger"
          onClick={() => { void logout().then(() => navigate("/login")); }}
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          Cerrar sesión
        </Button>
      </div>
      </div>
      )}
    </div>
  );
}
