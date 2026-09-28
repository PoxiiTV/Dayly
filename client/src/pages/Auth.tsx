import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Fingerprint } from "lucide-react";
import { BrandLogo } from "@/components/icons";
import { BrandName } from "@/components/BrandName";
import { AppVersion } from "@/components/AppVersion";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import { APP_NAME } from "@brand";
import { useAuth } from "@/lib/auth";
import { Button, Input, Spinner, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api";

/**
 * Login pitch, grouped because the flat list had outgrown the panel: seventy
 * releases in, naming every feature one per line meant either scrolling or
 * leaving half of them out. Ordered by daily usefulness, core agenda first.
 */
const AUTH_FEATURES: { title: string; items: string }[] = [
  {
    title: "Tu día, ordenado",
    items: "Mi día, calendario con arrastre, tareas con subtareas y repetición, proyectos, notas y alta rápida en español con + o Ctrl+K",
  },
  {
    title: "El dinero y las rutinas",
    items: "Suscripciones, con aviso antes de cada cargo y cuánto te cuestan al mes de verdad · hábitos, objetivos, concentración y estadísticas",
  },
  {
    title: "Hablar con la gente",
    items: "Chat con zumbidos, GIF, archivos y grupos · correo en vivo, WhatsApp y Telegram Business, con respuestas programadas y pausa segura",
  },
  {
    title: "A tu manera",
    items: "Generador de nicks con su frase debajo · tema, skins y fondos · menú lateral que reordenas y te sigue a cualquier dispositivo",
  },
  {
    title: "Y además",
    items: "Navegador con historial cifrado y WARP · visualizador de música · radio y Spotify · Calen, tu mascota con IA · app de Windows",
  },
  {
    title: "Tuyo y solo tuyo",
    items: "Kontraseñas cifradas en tu navegador, que ni el servidor ve · 2FA y passkeys · tus datos, exportables y borrables cuando quieras",
  },
];

export function AuthPage({ mode }: { mode: "login" | "register" | "forgot" | "reset" }) {
  const { login, register, user, allowPublicRegistration, refresh } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tf, setTf] = useState("");
  const [totpStep, setTotpStep] = useState(false);
  const [done, setDone] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const from = (loc.state as { from?: string })?.from ?? "/";

  const loginWithPasskey = async () => {
    setPasskeyBusy(true);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const { http } = await import("@/lib/api");
      const opts = await http.post<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"]; challengeId: string }>("/api/auth/passkeys/login/options");
      const response = await startAuthentication({ optionsJSON: opts.options });
      const data = await http.post<{ user: { mustChangePassword?: boolean } }>("/api/auth/passkeys/login", { challengeId: opts.challengeId, response });
      await refresh();
      navigate(data.user.mustChangePassword ? "/set-password" : from, { replace: true });
    } catch (err: any) {
      const msg = err?.message ?? "No se pudo entrar con passkey.";
      if (/not allowed|abort/i.test(msg)) push("info", "Inicio de sesión cancelado.");
      else push("error", msg);
    } finally {
      setPasskeyBusy(false);
    }
  };

  // Same component instance is reused across /login /forgot /reset — reset local UI.
  useEffect(() => {
    setDone(false);
    setBusy(false);
    setPassword("");
    setTf("");
    setTotpStep(false);
  }, [mode]);

  if (user?.mustChangePassword) return <Navigate to="/set-password" replace />;
  if (mode === "register" && !allowPublicRegistration) return <Navigate to="/login" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        try {
          const u = await login(email, password, totpStep ? (tf || undefined) : undefined);
          navigate(u.mustChangePassword ? "/set-password" : from, { replace: true });
        } catch (err: unknown) {
          if (err instanceof ApiError && err.code === "TWO_FACTOR_REQUIRED") {
            setTotpStep(true);
            setTf("");
            return;
          }
          throw err;
        }
      } else if (mode === "register") {
        await register(name, email, password); navigate(from, { replace: true }); push("success", `¡Cuenta creada! Bienvenido/a a ${APP_NAME} 🎉`);
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
    <div className="min-h-screen flex safe-top safe-bottom relative">
      <ThemeToggleButton className="absolute z-20 top-4 right-4" />
      {/* Left visual brand panel (desktop) */}
      <div className="auth-brand-panel hidden lg:flex flex-1 relative overflow-hidden max-h-screen">
        <div className="relative z-10 my-auto w-full max-w-lg px-10 py-12 text-white overflow-y-auto max-h-full">
          <div className="flex items-center gap-4 mb-8">
            <BrandLogo className="w-16 h-16" />
            <div className="flex flex-col leading-none">
              <BrandName className="text-4xl" variant="onDark" />
              <AppVersion className="mt-1.5 text-white/80" />
            </div>
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight">Organiza tu día entero<br/>sin perderte nunca.</h1>
          <p className="mt-4 text-white/60 text-lg">Tu agenda y centro de productividad.</p>
          <div className="mt-7 space-y-3.5">
            {AUTH_FEATURES.map((group) => (
              <div key={group.title} className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 mt-1 shrink-0 text-brand" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{group.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-white/70">{group.items}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <BrandLogo className="w-14 h-14" />
            <div className="flex flex-col leading-none">
              <BrandName className="text-3xl" />
              <AppVersion className="mt-1.5" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-text tracking-tight">
            {mode === "login" && totpStep
              ? "Verificación en dos pasos"
              : mode === "login" ? "Hola de nuevo"
              : mode === "register" ? "Crea tu cuenta"
              : mode === "forgot" ? "Recuperar contraseña"
              : "Nueva contraseña"}
          </h2>
          <p className="text-sm text-muted mt-1 mb-6">
            {mode === "login" && totpStep
              ? `Abre tu app de autenticación o usa un código de recuperación para ${email}.`
              : mode === "login" ? `Inicia sesión en tu espacio de ${APP_NAME}.`
              : mode === "register" ? "Empieza a organizar tu vida y tu trabajo."
              : mode === "forgot" ? "Te enviaremos un enlace para restablecerla."
              : "Elige una contraseña segura."}
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
              {mode === "login" && totpStep ? (
                <Input label="Código 2FA o de recuperación" value={tf} onChange={(e) => setTf(e.target.value)} placeholder="6 dígitos o código de un uso" maxLength={24} autoComplete="one-time-code" required autoFocus />
              ) : (
                <>
                  {mode === "register" && <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" required autoFocus />}
                  <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required autoFocus={mode !== "register"} />
                  {(mode === "login" || mode === "register" || mode === "reset") && (
                    <Input label="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" required minLength={10} />
                  )}
                </>
              )}
              <Button type="submit" disabled={busy} className="w-full mt-2">{busy ? <Spinner /> : mode === "login" && totpStep ? "Verificar y entrar" : mode === "login" ? "Entrar" : mode === "register" ? "Crear cuenta" : mode === "forgot" ? "Enviar enlace" : "Guardar contraseña"}</Button>
              {mode === "login" && !totpStep && (
                <Button type="button" variant="secondary" className="w-full" disabled={passkeyBusy} onClick={() => void loginWithPasskey()}>
                  {passkeyBusy ? <Spinner /> : <><Fingerprint className="w-4 h-4" />Entrar con passkey</>}
                </Button>
              )}
            </form>
          )}

          {!done && (
          <div className="mt-6 text-center text-sm text-muted">
            {mode === "login" && totpStep ? (
              <button type="button" className="inline-flex items-center gap-1.5 text-accent hover:underline" onClick={() => { setTotpStep(false); setTf(""); }}>
                <ArrowLeft className="w-4 h-4" />Volver
              </button>
            ) : mode === "login" ? (
              <>
                <Link to="/forgot" className="text-accent hover:underline">¿Has olvidado tu contraseña?</Link>
                {allowPublicRegistration && (
                  <div className="mt-3">¿No tienes cuenta? <Link to="/register" className="text-accent font-medium hover:underline">Regístrate</Link></div>
                )}
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
