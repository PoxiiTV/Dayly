import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { BrandLogo } from "@/components/icons";
import { BrandName } from "@/components/BrandName";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import { Button, Input, Spinner, useToast } from "@/components/ui";

export function ForcePasswordPage() {
  const { user, logout, refresh } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      push("error", "Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await http.post("/api/auth/first-password", { password });
      await refresh();
      push("success", "Contraseña guardada. La del correo ya no vale.");
      navigate("/", { replace: true });
    } catch (err: any) {
      push("error", err?.message ?? "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex safe-top safe-bottom">
      <div className="hidden lg:flex flex-1 auth-brand relative overflow-hidden">
        <div className="relative z-10 m-auto max-w-md px-10">
          <div className="flex items-center gap-3 mb-8">
            <BrandLogo className="w-10 h-10" />
            <BrandName className="text-2xl" />
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-text">Una contraseña solo tuya.</h1>
          <p className="mt-4 text-muted text-lg">La que llegó por correo es temporal. Elige una nueva para entrar de verdad.</p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <BrandLogo className="w-9 h-9" />
            <BrandName className="text-2xl" />
          </div>
          <h2 className="text-2xl font-bold text-text tracking-tight">Elige tu contraseña</h2>
          <p className="text-sm text-muted mt-1 mb-6">
            Hola{user?.name ? `, ${user.name}` : ""}. No puedes saltarte este paso: la clave del correo deja de valer al guardar.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <Input label="Nueva contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mín. 10, mayúscula y número" required minLength={10} autoFocus />
            <Input label="Repite la contraseña" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="La misma otra vez" required minLength={10} />
            <p className="text-xs text-muted flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />Mínimo 10 caracteres, una mayúscula y un número.</p>
            <Button type="submit" disabled={busy} className="w-full">{busy ? <Spinner /> : "Guardar y entrar"}</Button>
          </form>
          <button type="button" onClick={() => logout()} className="mt-6 w-full text-sm text-muted hover:text-text">Cerrar sesión</button>
        </div>
      </div>
    </div>
  );
}
