const BODY_MAX_CHARS = 50_000;

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function clipBody(text: string): string {
  if (text.length <= BODY_MAX_CHARS) return text;
  return text.slice(0, BODY_MAX_CHARS) + "\n\n[…]";
}

export function snippetOf(text: string, max = 140): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, max - 1).trimEnd() + "…";
}

export function quotePlain(text: string): string {
  const trimmed = text.replace(/\s+$/g, "");
  if (!trimmed) return "";
  return trimmed.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
}

export function buildReplySubject(subject: string): string {
  const s = subject.trim() || "(sin asunto)";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

export function formatFrom(name: string | undefined, address: string | undefined): string {
  const n = name?.trim();
  const a = address?.trim();
  if (n && a) return `${n} <${a}>`;
  return n || a || "Desconocido";
}

type ImapLikeError = {
  message?: string;
  code?: string;
  authenticationFailed?: boolean;
  responseText?: string;
  serverResponseCode?: string;
  responseStatus?: string;
  executedCommand?: string;
  command?: string;
  errno?: string | number;
};

export type ImapErrorFields = {
  message: string;
  haystack: string;
  code?: string;
  authenticationFailed: boolean;
  responseText?: string;
  serverResponseCode?: string;
  command?: string;
};

/** ImapFlow often uses message "Command failed" and puts the real reason in other fields. */
export function imapErrorFields(err: unknown): ImapErrorFields {
  const e = (err ?? {}) as ImapLikeError;
  const message = err instanceof Error ? err.message : String(err);
  const responseText = typeof e.responseText === "string" ? e.responseText : undefined;
  const code = typeof e.code === "string" ? e.code : undefined;
  const serverResponseCode = typeof e.serverResponseCode === "string" ? e.serverResponseCode : undefined;
  const command = typeof e.executedCommand === "string"
    ? e.executedCommand
    : typeof e.command === "string"
      ? e.command
      : undefined;
  const authenticationFailed = e.authenticationFailed === true
    || /AUTHENTICATIONFAILED/i.test(serverResponseCode ?? "")
    || /AUTHENTICATIONFAILED/i.test(responseText ?? "");
  const haystack = [message, code, responseText, serverResponseCode, command, String(e.errno ?? "")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return { message, haystack, code, authenticationFailed, responseText, serverResponseCode, command };
}

export function imapErrorDetails(err: unknown, host?: string) {
  const f = imapErrorFields(err);
  return {
    imap: {
      host,
      code: f.code,
      authenticationFailed: f.authenticationFailed,
      responseText: f.responseText?.slice(0, 240),
      serverResponseCode: f.serverResponseCode,
      command: f.command,
      message: f.message.slice(0, 240),
    },
  };
}

function zohoWrongServer(haystack: string, serverResponseCode?: string): boolean {
  return /server details.+incorrect|seems incorrect|wrong server/.test(haystack)
    || (/alert/i.test(serverResponseCode ?? "") && /incorrect|server details/.test(haystack));
}

function imapNotEnabled(haystack: string): boolean {
  return /yet to enable imap|enable imap|imap.{0,60}(disabled|not enabled|access is not)|imapaccess|imap for your account/.test(haystack);
}

export function imapErrorMessage(err: unknown, host?: string): string {
  const f = imapErrorFields(err);
  const zoho = Boolean(host && /zoho\./i.test(host));
  if (zoho && zohoWrongServer(f.haystack, f.serverResponseCode)) {
    if (/imappro|smtppro/i.test(host ?? "")) {
      return "Zoho rechaza imappro/smtppro para esta cuenta. Usa imap.zoho.eu y smtp.zoho.eu (proveedor «Zoho Mail (Europa)»). Con Authy/2FA pega una contraseña de aplicación, no la de la web. Los hosts exactos están en Zoho Mail → Ajustes → Cuentas de correo.";
    }
    return "Zoho indica que el servidor IMAP no coincide con esta cuenta. Si usabas imap.zoho.eu, prueba imappro.zoho.eu (o al revés). Copia los hosts de Zoho Mail → Ajustes → Cuentas de correo. Con 2FA usa una contraseña de aplicación.";
  }
  if (imapNotEnabled(f.haystack)) {
    return "IMAP no está disponible en esa cuenta de Zoho. En el plan gratuito (y en algunas políticas de organización) no hay IMAP: hay que pasar a un plan de pago o pedir al administrador que lo active. Authy y la contraseña de aplicación no sirven hasta que IMAP exista.";
  }
  if (
    f.authenticationFailed
    || /auth|login|credentials|password|eauth|invalid user|application.?specific.?password/.test(f.haystack)
  ) {
    if (zoho) {
      return "No se pudo entrar en el buzón de Zoho. Con 2FA (Authy) usa una contraseña de aplicación (accounts.zoho.eu → Seguridad), no la de la web ni el código de Authy. Activa IMAP en Zoho Mail → Ajustes → Cuentas de correo y copia el host que sale ahí.";
    }
    return "No se pudo entrar en el buzón. Revisa usuario y contraseña. En Gmail, Outlook, Yahoo y Zoho usa una contraseña de aplicación.";
  }
  if (/timeout|timed out|etimedout|greeting/.test(f.haystack)) {
    return "El servidor de correo no responde. Inténtalo de nuevo.";
  }
  if (/enotfound|econnection|econnreset|econnrefused|connect|certificate|tls|ssl|self signed|closedafterconnect|noconnection/.test(f.haystack)) {
    return "No se pudo conectar con el servidor de correo. Revisa host, puerto y cifrado.";
  }
  return "No se pudo completar la operación de correo. Inténtalo de nuevo.";
}
