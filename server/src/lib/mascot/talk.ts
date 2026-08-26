import { prisma } from "../prisma.js";
import { asMascotProvider, hydrateKeyVault, keyEncFor } from "./keys.js";
import { resolveChatTarget, type OpenCodeLane } from "./catalog.js";
import { completeChat, type ChatMessage } from "./client.js";
import { MASCOT_TOOLS, parseToolArgs, runMascotTool } from "./tools.js";
import { memoryBlurb, buildDayContext } from "./context.js";
import { systemPrompt } from "./prompt.js";

/**
 * Procesa un mensaje de Calen como si viniera de la web (sin streaming):
 * monta sistema + memoria + contexto del día, ejecuta tools y devuelve la
 * respuesta final. Null si el usuario no tiene API key configurada.
 */
export async function runMascotReply(userId: string, text: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, city: true, mascotProvider: true, mascotModel: true, mascotBaseUrl: true, mascotApiKeyEnc: true, mascotApiKeysEnc: true },
  });
  if (!u) return null;
  const provider = asMascotProvider(u.mascotProvider);
  const vault = hydrateKeyVault(u.mascotApiKeysEnc, u.mascotApiKeyEnc, u.mascotProvider);
  const apiKeyEnc = keyEncFor(vault, provider);
  if (!apiKeyEnc) return null;

  let model: string;
  let lane: OpenCodeLane | undefined;
  try {
    const target = await resolveChatTarget(provider, u.mascotModel || "auto-free");
    model = target.model;
    lane = target.lane;
  } catch {
    return "No tengo un modelo disponible ahora mismo. Revisa Ajustes → Mascota.";
  }

  const tz = u.timezone || "Europe/Madrid";
  const [memory, dayContext] = await Promise.all([memoryBlurb(userId), buildDayContext(userId, tz)]);
  const extraSystem: string[] = [];
  if (memory) extraSystem.push(`Lo que recuerdas tuyo:\n${memory}`);
  extraSystem.push(dayContext);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(tz, u.city) },
    { role: "system", content: extraSystem.join("\n\n") },
    { role: "user", content: text.slice(0, 4000) },
  ];

  try {
    let reply = "";
    for (let i = 0; i < 6; i++) {
      const out = await completeChat({ provider, apiKeyEnc, customBase: u.mascotBaseUrl, model, lane, messages, tools: [...MASCOT_TOOLS] });
      if (out.tool_calls?.length) {
        messages.push({ role: "assistant", content: out.content, tool_calls: out.tool_calls });
        for (const call of out.tool_calls) {
          const parsed = parseToolArgs(call.function.arguments);
          const result = await runMascotTool(userId, tz, call.function.name, parsed);
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
        continue;
      }
      reply = (out.content ?? "").trim();
      break;
    }
    return reply || "No pude completar la acción. ¿Lo intentamos de otra forma?";
  } catch (err) {
    return err instanceof Error && err.message ? `Ups: ${err.message}` : "El proveedor de IA no pudo completar la petición.";
  }
}