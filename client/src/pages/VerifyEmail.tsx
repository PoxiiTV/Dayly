import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { APP_NAME } from "@brand";
import { Button, Spinner, useToast } from "@/components/ui";
import { http } from "@/lib/api";

export function VerifyEmailPage() {
  const nav = useNavigate();
  const { push } = useToast();
  const [state, setState] = useState<"busy" | "ok" | "err">("busy");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) { setState("err"); return; }
    http.get("/api/auth/verify-email", { token })
      .then(() => { setState("ok"); push("success", "Email confirmado"); })
      .catch(() => setState("err"));
  }, [push]);

  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="max-w-sm w-full text-center">
        {state === "busy" && <Spinner className="w-8 h-8 mx-auto" />}
        {state === "ok" && (
          <>
            <div className="w-14 h-14 rounded-2xl bg-ok/15 text-ok grid place-items-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7" /></div>
            <h1 className="text-xl font-bold text-text">Email confirmado</h1>
            <p className="text-sm text-muted mt-2">Ya puedes usar {APP_NAME} con la cuenta verificada.</p>
            <Button className="mt-6 w-full" onClick={() => nav("/")}>Entrar</Button>
          </>
        )}
        {state === "err" && (
          <>
            <h1 className="text-xl font-bold text-text">Enlace no válido</h1>
            <p className="text-sm text-muted mt-2">Pide uno nuevo desde tu cuenta o el registro.</p>
            <Button className="mt-6 w-full" onClick={() => nav("/login")}>Ir al inicio de sesión</Button>
          </>
        )}
      </div>
    </div>
  );
}
