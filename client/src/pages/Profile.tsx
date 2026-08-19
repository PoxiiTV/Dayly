import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Avatar, Button, Input, useToast, Spinner } from "@/components/ui";
import { http } from "@/lib/api";
import { localKey } from "@/lib/dates";

export function Profile() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const { push } = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const save = async () => {
    setBusy(true);
    try {
      await http.patch("/api/users/me", { name: name.trim() });
      await refresh(); qc.invalidateQueries(); push("success", "Perfil actualizado");
    } catch (e: any) { push("error", e.message); } finally { setBusy(false); }
  };

  const joined = "";
  void joined; void localKey;

  return (
    <div className="max-w-xl mx-auto animate-fade-in space-y-6">
      <h1 className="text-2xl font-bold text-text tracking-tight">Perfil</h1>
      <div className="card p-6 flex items-center gap-5">
        <Avatar name={user.name} size={72} />
        <div>
          <h2 className="text-xl font-bold text-text">{user.name}</h2>
          <p className="text-sm text-muted">{user.email}</p>
          <span className="chip mt-1.5 bg-accent-soft text-accent-strong">{user.roleName === "ADMIN" ? "Administrador" : "Usuario"}</span>
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
  );
}