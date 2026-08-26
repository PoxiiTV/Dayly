import { APP_NAME } from "./brand.js";

export const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Web-safe stack. Outlook/Plesk reset <h1>/<p> to Times unless every tag has this. */
const FONT = EMAIL_FONT;

export function escapeHtml(value: string): string {
  return value.replace(/[<>&"'`]/g, (c) => {
    const map: Record<string, string> = {
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;", "`": "&#96;",
    };
    return map[c] ?? c;
  });
}

export function emailP(html: string, opts?: { muted?: boolean; last?: boolean }): string {
  const color = opts?.muted ? "#5f6368" : "#3f3f46";
  const size = opts?.muted ? "14px" : "16px";
  const margin = opts?.last ? "0" : "0 0 16px";
  return `<p style="margin:${margin};padding:0;font-family:${FONT};font-size:${size};line-height:1.65;color:${color};">${html}</p>`;
}

/** Label + value box (credentials). Courier so 0/O and 1/l se distinguen. */
export function emailKv(label: string, value: string): string {
  const mono = "Consolas,'Courier New',Courier,monospace";
  return `<p style="margin:0 0 4px;padding:0;font-family:${FONT};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">${escapeHtml(label)}</p>
<p style="margin:0 0 14px;padding:10px 12px;font-family:${mono};font-size:15px;line-height:1.4;color:#18181b;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;word-break:break-all;">${escapeHtml(value)}</p>`;
}

export function renderEmail(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footerNote?: string;
}): string {
  const year = new Date().getFullYear();
  const url = escapeHtml(opts.ctaUrl);
  const footer = opts.footerNote
    ?? "No compartas el enlace: quien lo tenga puede actuar en tu nombre.";
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(APP_NAME)}</title>
  <!--[if mso]>
  <style type="text/css">
    table, td, p, a, span, strong { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    :root { color-scheme: light only; }
    body, table, td, p, a, span, strong {
      font-family: ${FONT} !important;
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-family:${FONT};">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5;font-family:${FONT};">
    <tr>
      <td align="center" style="padding:36px 16px;font-family:${FONT};">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%;font-family:${FONT};">
          <tr>
            <td style="padding:0 4px 24px;font-family:${FONT};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:36px;height:36px;font-family:${FONT};">
                    <img src="${escapeHtml((process.env.PUBLIC_URL ?? "https://agenda.example.com").replace(/\/$/, ""))}/brand/icon-192.png" width="36" height="36" alt="${escapeHtml(APP_NAME)}" style="display:block;width:36px;height:36px;border:0;border-radius:10px;" />
                  </td>
                  <td style="padding-left:10px;font-family:${FONT};font-weight:700;font-size:20px;color:#18181b;letter-spacing:-0.02em;">${escapeHtml(APP_NAME)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:32px 28px;font-family:${FONT};">
              <p style="margin:0 0 6px;padding:0;font-family:${FONT};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#71717a;">Tu agenda</p>
              <p style="margin:0 0 18px;padding:0;font-family:${FONT};font-size:24px;line-height:1.3;color:#18181b;font-weight:700;">${opts.heading}</p>
              ${opts.bodyHtml}
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius:10px;background:#4f46e5;font-family:${FONT};">
                    <a href="${url}" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(opts.ctaLabel)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;padding:0;font-family:${FONT};font-size:12px;line-height:1.55;color:#71717a;">Si el botón no abre, copia este enlace:<br />
                <a href="${url}" style="font-family:${FONT};color:#2563eb;word-break:break-all;text-decoration:underline;">${url}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 8px 8px;font-family:${FONT};font-size:12px;color:#71717a;line-height:1.6;">
              © ${year} ${escapeHtml(APP_NAME)} · Mensaje de cuenta y seguridad.<br />
              ${escapeHtml(footer)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
