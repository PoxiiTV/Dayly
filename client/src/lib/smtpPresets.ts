export type SmtpPreset = {
  id: string;
  label: string;
  host: string;
  port: number;
  hint: string;
};

export const SMTP_PRESETS: SmtpPreset[] = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: 587,
    hint: "El usuario es el correo completo. Usa una contraseña de aplicación, o en la bandeja Conectar con Google.",
  },
  {
    id: "outlook",
    label: "Outlook / Hotmail / Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    hint: "El usuario es el correo completo. En cuentas @outlook/@hotmail, si falla, prueba smtp-mail.outlook.com.",
  },
  {
    id: "outlook-live",
    label: "Outlook.com (smtp-mail)",
    host: "smtp-mail.outlook.com",
    port: 587,
    hint: "Variante para cuentas personales de Outlook, Hotmail o Live.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    host: "smtp.zoho.com",
    port: 587,
    hint: "El usuario es el correo completo. Con 2FA (Authy) usa una contraseña de aplicación.",
  },
  {
    id: "zoho-org",
    label: "Zoho Mail (dominio propio)",
    host: "smtppro.zoho.com",
    port: 587,
    hint: "SMTP de organización. Con 2FA usa una contraseña de aplicación.",
  },
  {
    id: "zoho-eu",
    label: "Zoho Mail (Europa)",
    host: "smtp.zoho.eu",
    port: 587,
    hint: "Para cuentas alojadas en la UE. Con 2FA usa una contraseña de aplicación.",
  },
  {
    id: "zoho-eu-org",
    label: "Zoho Mail (Europa, dominio propio)",
    host: "smtppro.zoho.eu",
    port: 587,
    hint: "SMTP de organización en datacenter UE. Con 2FA usa una contraseña de aplicación.",
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    host: "smtp.mail.yahoo.com",
    port: 587,
    hint: "El usuario es el correo completo. Yahoo exige una contraseña de aplicación.",
  },
];

export function smtpPresetIdForHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  return SMTP_PRESETS.find((preset) => preset.host === normalized)?.id ?? "custom";
}

export function smtpPresetById(id: string): SmtpPreset | undefined {
  return SMTP_PRESETS.find((preset) => preset.id === id);
}
