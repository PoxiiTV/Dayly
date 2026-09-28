export type MailboxPreset = {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  hint: string;
};

export const MAILBOX_PRESETS: MailboxPreset[] = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Lo más sencillo: Conectar con Google (confirmas en el móvil). Si no, una contraseña de aplicación en Cuenta de Google → Seguridad.",
  },
  {
    id: "outlook",
    label: "Outlook / Hotmail / Microsoft 365",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "El usuario es el correo completo. En cuentas personales puede hacer falta una contraseña de aplicación.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    imapHost: "imap.zoho.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.zoho.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "El usuario es el correo completo. IMAP en Zoho solo existe en planes de pago. Si en Ajustes → Cuentas de correo sale «no disponible», hay que subir de plan. Con 2FA usa una contraseña de aplicación.",
  },
  {
    id: "zoho-org",
    label: "Zoho Mail (dominio propio)",
    imapHost: "imappro.zoho.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtppro.zoho.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Para correos tipo tu@empresa.com. IMAP en Zoho es de plan de pago. Si Ajustes → Cuentas de correo dice que no está disponible, no va a conectar. Con 2FA usa una contraseña de aplicación.",
  },
  {
    id: "zoho-eu",
    label: "Zoho Mail (Europa)",
    imapHost: "imap.zoho.eu",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.zoho.eu",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Para cuentas en datacenter UE (mail.zoho.eu). IMAP no viene en el plan gratuito: si Ajustes → Cuentas de correo dice «no disponible», hay que pasar a un plan de pago. Con Authy, cuando IMAP exista, usa una contraseña de aplicación.",
  },
  {
    id: "zoho-eu-org",
    label: "Zoho Mail (Europa, dominio propio)",
    imapHost: "imappro.zoho.eu",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtppro.zoho.eu",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Solo si Zoho muestra imappro/smtppro y el plan incluye IMAP (de pago). Si sale «no disponible», no hay forma de leer el buzón desde aquí hasta subir de plan.",
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "El usuario es el correo completo. Yahoo exige una contraseña de aplicación.",
  },
];

export function mailboxPresetIdForHosts(imapHost: string, smtpHost: string): string {
  const imap = imapHost.trim().toLowerCase();
  const smtp = smtpHost.trim().toLowerCase();
  return MAILBOX_PRESETS.find((preset) => preset.imapHost === imap && preset.smtpHost === smtp)?.id ?? "custom";
}

export function mailboxPresetById(id: string): MailboxPreset | undefined {
  return MAILBOX_PRESETS.find((preset) => preset.id === id);
}
