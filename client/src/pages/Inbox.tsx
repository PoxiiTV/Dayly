import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader, useToast } from "@/components/ui";
import { MessagesHub } from "@/components/MessagesHub";
import { integrationShown, useIntegrations } from "@/lib/integrations";

export function Inbox() {
  const [search, setSearch] = useSearchParams();
  const { push } = useToast();
  const integrations = useIntegrations();
  const channels = ["Correo", integrationShown(integrations.whatsapp) && "WhatsApp Business", integrationShown(integrations.telegram) && "Telegram Business"].filter(Boolean) as string[];
  const lead = channels.length > 1
    ? `${channels.slice(0, -1).join(", ")} y ${channels.at(-1)} en un mismo lugar, con recordatorios y envíos programados.`
    : "Tu correo en un mismo lugar, con recordatorios y respuestas.";

  useEffect(() => {
    const google = search.get("google");
    if (!google) return;
    if (google === "ok") push("success", "Gmail conectado con Google");
    else {
      const reason = search.get("reason");
      const msg = reason === "denied"
        ? "No se concedió acceso a Gmail."
        : reason === "session"
          ? "Inicia sesión en la agenda y vuelve a conectar Gmail."
          : reason === "token"
            ? "Google no dio un permiso duradero. Vuelve a conectar y acepta el acceso al correo."
            : "No se pudo conectar Gmail con Google.";
      push("error", msg);
    }
    const next = new URLSearchParams(search);
    next.delete("google");
    next.delete("reason");
    next.delete("mail");
    setSearch(next, { replace: true });
  }, [push, search, setSearch]);

  return (
    <div className="page-shell">
      <PageHeader title="Mensajes" lead={lead} />
      <MessagesHub />
    </div>
  );
}
