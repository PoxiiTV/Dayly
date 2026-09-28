import { prisma } from "../prisma.js";
import { decryptSecret } from "../crypto.js";
import { ApiError } from "../errors.js";
import { completeChat, type ChatMessage } from "./client.js";
import { resolveChatTarget, type OpenCodeLane } from "./catalog.js";
import { asMascotProvider, hydrateKeyVault, keyEncFor } from "./keys.js";
import { describeNow } from "./time.js";
import { asMascotId, mascotName } from "./characters.js";
import { MASCOT_TOOLS, parseToolArgs, radioActionFromToolResult, runMascotTool, type MascotRadioAction } from "./tools.js";
import { APP_NAME } from "../brand.js";
import {
  MESSAGING_MASCOT_TOOLS,
  resolveMessagingAssistantContext,
  runMessagingMascotTool,
  type MessagingAssistantRequest,
} from "../messaging/kalen.js";

export type MascotChannel = "web" | "telegram";
export type MascotUserMessage = { role: "user" | "assistant"; content: string };

export type MascotTurnResult = {
  reply: string;
  model: string;
  actions: MascotRadioAction[];
  preparedReplyId?: string;
};

const RADIO_TOOLS = new Set(["radio_control", "list_radio_stations"]);

export function mascotSystemPrompt(tz: string, channel: MascotChannel = "web", name = "Kalen"): string {
  const now = describeNow(tz || "Europe/Madrid");
  const radio = channel === "telegram"
    ? "No puedes controlar la radio desde Telegram; si te lo piden, di que hay que hacerlo en la web."
    : "También puedes controlar la radio integrada: usa radio_control con action=play para reproducir, action=pause para pausar y action=set_station para cambiar de emisora. Para seleccionar una emisora usa stationName o stationId; si no conoces el nombre exacto, consulta antes list_radio_stations. Si el usuario dice \"pon [emisora]\", cambia a ella y reprodúcela.";
  const telegram = channel === "telegram"
    ? `\nEstás hablando por Telegram. Responde breve (unas pocas frases, sin markdown). Si el usuario suelta una idea o recado, usa capture_inbox; si pide una tarea concreta, create_task; si pide que le avisen, create_reminder.`
    : "";
  return `Eres ${name}, la mascota kawaii de ${APP_NAME}, una agenda personal. Hablas español, breve y simpática (sin emojis excesivos). Si te preguntan tu nombre, dices ${name}.
Puedes gestionar de verdad todo el contenido de la agenda: tareas y todos sus detalles (descripción, notas, estado, fecha, prioridad, proyecto, etiquetas, subtareas y avisos de Telegram), notas (leer y escribir contenido, fijar, archivar, marcar favorita y enviar a papelera), proyectos, eventos, recordatorios, hábitos, objetivos, bandeja de entrada, papelera y temporizadores. También puedes consultar clima, partidos de fútbol, recetas y ejercicios básicos.
No puedes adjuntar archivos desde el chat ni realizar búsquedas generales, código, noticias, deberes o temas ajenos; para lo demás usa las herramientas disponibles y no inventes capacidades.
No puedes abrir, listar ni recordar el Cofre de contraseñas. Si te piden claves, contraseñas o 1Password/KeePass, di que eso está en Cofre (menú) y que tú no tienes acceso.
Zona horaria del usuario (Ajustes): ${now.zone} (${now.offset}). Ahora mismo: ${now.wall} (${now.ymd}). Interpreta "hoy", "mañana" y las horas en esa zona, no en UTC del servidor.
Usa las herramientas para leer o cambiar datos reales. NUNCA confirmes una escritura o borrado si la herramienta no devolvió una línea que empiece por "OK id=". Si recibes "NO_OK", explica el motivo en lenguaje claro y pide solo el dato que falte. Si el usuario insiste en una acción que sí está dentro de tus capacidades, ejecútala; no repitas una negativa antigua.
${radio}
Para editar una tarea o nota, busca primero sus detalles si faltan el id y hay más de una coincidencia. Para listar tareas usa when=completed cuando te pidan las completadas.
Si te piden activar o desactivar el aviso de Telegram de una tarea, usa update_task con notifyTelegram true o false. Si al crear una tarea piden aviso por Telegram, pásalo en create_task (notifyTelegram true). No inventes el aviso: o la tool lo confirma o no está activo.
No uses herramientas para un saludo. Para acciones de agenda, llama a la tool ANTES de responder.
Para fútbol (próximo partido, resultado, calendario) usa SIEMPRE football_lookup, nunca web_search. Si el usuario quiere un aviso, crea el recordatorio con la fecha ISO que te devuelva la herramienta.
Para clima, temperatura, lluvia o previsión usa SIEMPRE weather_lookup (Open-Meteo), nunca web_search. Si no dicen ciudad, deja place vacío: se usa la de su zona horaria. kind: now, today, tomorrow o week.
Comida y ejercicio: puedes responder de tu conocimiento. web_search SOLO para recetas/menús, ejercicio básico, o datos prácticos de una tarea (horario de un comercio, farmacia, supermercado). Nunca para noticias, código ni temas ajenos.${telegram}`;
}

function toolsFor(channel: MascotChannel) {
  if (channel === "web") return [...MASCOT_TOOLS];
  return MASCOT_TOOLS.filter((tool) => !RADIO_TOOLS.has(tool.function.name));
}

export async function runMascotTurn(opts: {
  userId: string;
  messages: MascotUserMessage[];
  channel?: MascotChannel;
  /** Stable OpenCode conversation id (`x-opencode-session`). */
  sessionId?: string | null;
  messagingContext?: MessagingAssistantRequest;
  onDelta?: (text: string) => void;
}): Promise<MascotTurnResult> {
  const channel = opts.channel ?? "web";
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: opts.userId },
    select: { timezone: true, mascotCharacter: true, mascotProvider: true, mascotModel: true, mascotBaseUrl: true, mascotApiKeyEnc: true, mascotApiKeysEnc: true, mascotFootballKeyEnc: true },
  });
  const provider = asMascotProvider(u.mascotProvider);
  const vault = hydrateKeyVault(u.mascotApiKeysEnc, u.mascotApiKeyEnc, u.mascotProvider);
  const apiKeyEnc = keyEncFor(vault, provider);
  if (!apiKeyEnc) throw ApiError.badRequest("Configura la API key de la mascota en Ajustes.");
  const footballApiKey = u.mascotFootballKeyEnc ? decryptSecret(u.mascotFootballKeyEnc) : process.env.FOOTBALL_DATA_API_KEY?.trim() || null;
  let model: string;
  let lane: OpenCodeLane | undefined;
  try {
    const target = await resolveChatTarget(provider, u.mascotModel || "auto-free");
    model = target.model;
    lane = target.lane;
  } catch (e) {
    if ((e as Error).name === "NoFreeGoModel") {
      throw ApiError.badRequest("Ahora mismo OpenCode no tiene modelos gratis; elige uno de tu plan Go o OpenRouter.");
    }
    throw e;
  }

  const sessionId = opts.sessionId?.trim() || (opts.messagingContext
    ? `kalendiario:messaging:${opts.userId}:${Date.now()}`
    : `kalendiario:${channel}:${opts.userId}`);
  const messagingContext = opts.messagingContext
    ? await resolveMessagingAssistantContext(opts.userId, opts.messagingContext)
    : null;

  const messages: ChatMessage[] = [
    { role: "system", content: messagingContext ? messagingContext.prompt : mascotSystemPrompt(u.timezone, channel, mascotName(asMascotId(u.mascotCharacter))) },
    ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let reply = "";
  const radioActions: MascotRadioAction[] = [];
  let preparedReplyId: string | undefined;
  const seenToolCalls = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const out = await completeChat({
      provider,
      apiKeyEnc,
      customBase: u.mascotBaseUrl,
      model,
      lane,
      sessionId,
      messages,
      tools: messagingContext ? MESSAGING_MASCOT_TOOLS : toolsFor(channel),
      onDelta: opts.onDelta,
    });
    if (out.tool_calls?.length) {
      messages.push({ role: "assistant", content: out.content, tool_calls: out.tool_calls });
      for (const call of out.tool_calls) {
        const callKey = call.id || `${call.function.name}:${call.function.arguments}`;
        if (seenToolCalls.has(callKey)) {
          messages.push({ role: "tool", tool_call_id: call.id, content: "NO_OK code=duplicate_call | Esa llamada ya se ejecutó. Usa el resultado anterior y no la repitas." });
          continue;
        }
        seenToolCalls.add(callKey);
        const parsed = parseToolArgs(call.function.arguments);
        const result = messagingContext
          ? await runMessagingMascotTool(opts.userId, messagingContext, call.function.name, parsed)
          : await runMascotTool(opts.userId, u.timezone, call.function.name, parsed, { footballApiKey });
        const prepared = result.match(/^OK id=([^\s|]+)/);
        if (messagingContext && prepared?.[1]) preparedReplyId = prepared[1];
        const radioAction = radioActionFromToolResult(call.function.name, result);
        if (radioAction) radioActions.push(radioAction);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      continue;
    }
    reply = (out.content ?? "").trim();
    break;
  }
  if (!reply) {
    const lastTool = [...messages].reverse().find((message) => message.role === "tool")?.content?.trim() ?? "";
    if (lastTool.startsWith("OK id=")) {
      reply = lastTool.replace(/^OK id=\S+\s*\|\s*/, "");
    } else if (lastTool.startsWith("NO_OK")) {
      reply = `No he podido completar la acción: ${lastTool.replace(/^NO_OK(?:\s+code=[^|]+)?\s*\|\s*/, "")}`;
    } else {
      reply = "No he podido completar la acción. Indícame qué quieres cambiar y, si puedes, el título o el id.";
    }
  }
  return { reply, model, actions: radioActions, ...(preparedReplyId ? { preparedReplyId } : {}) };
}
