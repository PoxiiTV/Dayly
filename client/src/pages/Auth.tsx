import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { BrandLogo } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { Button, Input, Spinner, useToast } from "@/components/ui";

export function AuthPage({ mode }: { mode: "login" | "register" | "forgot" | "reset" }) {
  const { login, register, user } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tf, setTf] = useState("");
  const [done, setDone] = useState(false);

  const from = (loc.state as { from?: string })?.from ?? "/";

  // Same component instance is reused across /login /forgot /reset — reset local UI.
  useEffect(() => {
    setDone(false);
    setBusy(false);
    setPassword("");
    setTf("");
  }, [mode]);

  if (user?.mustChangePassword) return <Navigate to="/set-password" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        try {
          const u = await login(email, password, tf || undefined);
          navigate(u.mustChangePassword ? "/set-password" : from, { replace: true });
        }
        catch (err: any) { if (err.code === "UNAUTHORIZED" && (err.message ?? "").toLowerCase().includes("dos pasos")) { setTf(""); } throw err; }
      } else if (mode === "register") {
        await register(name, email, password); navigate(from, { replace: true }); push("success", "¡Cuenta creada! Bienvenido/a a Dayly 🎉");
      } else if (mode === "forgot") {
        const { http } = await import("@/lib/api");
        await http.post("/api/auth/forgot-password", { email });
        setDone(true);
      } else {
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        const { http } = await import("@/lib/api");
        await http.post("/api/auth/reset-password", { token, password }); setDone(true); push("success", "Contraseña actualizada. Inicia sesión.");
      }
    } catch (err: any) {
      push("error", err?.message ?? "No se pudo completar.");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex safe-top safe-bottom">
      {/* Left visual brand panel (desktop) */}
      <div className="hidden lg:flex flex-1 bg-[radial-gradient(circle_at_20%_20%,#1d4ed8,transparent_60%),radial-gradient(circle_at_80%_80%,#7c3aed,transparent_55%),#0b1220] relative overflow-hidden">
        <div className="relative z-10 m-auto text-white max-w-md px-10">
          <div className="flex items-center gap-3 mb-8">
            <BrandLogo className="w-10 h-10" />
            <span className="font-bold text-2xl tracking-tight">Dayly</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight">Organiza tu día entero<br/>sin perderte nunca.</h1>
          <p className="mt-4 text-white/60 text-lg">Agenda, tareas, calendario, proyectos y productividad en una sola app profesional y ultrarápida.</p>
          <div className="mt-10 space-y-3 text-white/80">
            {["Calendario pulido con time-blocking", "Mi día como centro de control", "Privacidad y seguridad de verdad"].map((t) => (
              <div key={t} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-400" />{t}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <BrandLogo className="w-9 h-9" />
            <span className="font-bold text-2xl tracking-tight">Dayly</span>
          </div>

          <h2 className="text-2xl font-bold text-text tracking-tight">
            {mode === "login" ? "Hola de nuevo" : mode === "register" ? "Crea tu cuenta" : mode === "forgot" ? "Recuperar contraseña" : "Nueva contraseña"}
          </h2>
          <p className="text-sm text-muted mt-1 mb-6">
            {mode === "login" ? "Inicia sesión en tu espacio de Dayly." : mode === "register" ? "Empieza a organizar tu vida y tu trabajo." : mode === "forgot" ? "Te enviaremos un enlace para restablecerla." : "Elige una contraseña segura."}
          </p>

          {done && (mode === "forgot" || mode === "reset") ? (
            <div className="text-center py-8 animate-slide-up">
              <div className="w-14 h-14 rounded-2xl bg-ok/15 text-ok grid place-items-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
              <h3 className="font-semibold text-text">¡Listo!</h3>
              <p className="text-sm text-muted mt-1">
                {mode === "forgot"
                  ? "Si la cuenta existe, recibirás un email de recuperación. Revisa bandeja de entrada y spam del correo de esa cuenta."
                  : "Tu contraseña se ha actualizado."}
              </p>
              <div className="mt-5">
                <Button type="button" onClick={() => { setDone(false); navigate("/login", { replace: true }); }}>Volver al inicio de sesión</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {mode === "register" && <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" required autoFocus />}
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required autoFocus={mode !== "register"} />
              {(mode === "login" || mode === "register" || mode === "reset") && (
                <Input label="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" required minLength={10} />
              )}
              {mode === "login" && (
                <Input label="Código 2FA o de recuperación" value={tf} onChange={(e) => setTf(e.target.value)} placeholder="6 dígitos o código de un uso" maxLength={24} autoComplete="one-time-code" />
              )}
              <Button type="submit" disabled={busy} className="w-full mt-2">{busy ? <Spinner /> : mode === "login" ? "Entrar" : mode === "register" ? "Crear cuenta" : mode === "forgot" ? "Enviar enlace" : "Guardar contraseña"}</Button>
            </form>
          )}

          {!done && (
          <div className="mt-6 text-center text-sm text-muted">
            {mode === "login" ? (
              <>
                <Link to="/forgot" className="text-accent hover:underline">¿Has olvidado tu contraseña?</Link>
                <div className="mt-3">¿No tienes cuenta? <Link to="/register" className="text-accent font-medium hover:underline">Regístrate</Link></div>
              </>
            ) : mode === "register" ? (
              <div>¿Ya tienes cuenta? <Link to="/login" className="text-accent font-medium hover:underline">Inicia sesión</Link></div>
            ) : (
              <Link to="/login" className="inline-flex items-center gap-1.5 text-accent hover:underline"><ArrowLeft className="w-4 h-4" />Volver al inicio de sesión</Link>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}