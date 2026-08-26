/** Telegram Bot API — sendMessage via fetch (no extra SDK). */
const BOT_API = "https://api.telegram.org";

export function sendTelegramMessage(token: string, chatId: string, text: string): Promise<boolean> {
  const url = `${BOT_API}/bot${token}/sendMessage`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const data = (await r.json()) as { ok?: boolean };
      return data.ok === true;
    })
    .catch(() => false);
}

/** Bot-friendly identifier for the message sender. */
export function botName(token: string): string {
  return token.split(":")[0] ?? "";
}