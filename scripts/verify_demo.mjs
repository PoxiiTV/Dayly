const PORT = 9222;
const URL = "http://localhost:4173/Dayly/";

function wsToTarget(url) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(url);
    w._pending = new Map();
    w.onopen = () => resolve(w);
    w.onerror = () => reject(new Error("WS error connecting to " + url));
  });
}
async function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) { ws.removeEventListener("message", handler); resolve(msg); }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function main() {
  const pages = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const page = pages.find((p) => p.type === "page");
  const ws = await wsToTarget(page.webSocketDebuggerUrl);
  await rpc(ws, "Runtime.enable");

  let errors = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails?.exception?.description ?? "ex"));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
  });

  const nav = async (u) => { await rpc(ws, "Page.navigate", { url: u }); await new Promise((r) => setTimeout(r, 3600)); };
  const evalJs = async (e) => (await rpc(ws, "Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;

  await nav(URL);
  const body = (await evalJs("document.body.innerText")) ?? "";
  console.log("TITLE:", await evalJs("document.title"));
  console.log("Saludo:", /Buenos días|Buenas tardes|Buenas noches/.test(body));
  console.log("Agenda de hoy:", body.includes("Agenda de hoy"));
  console.log("Nav Proyectos:", body.includes("Proyectos"));
  console.log("Aviso modo demo:", body.includes("Modo demo"));
  console.log("SNIPPET:", body.slice(0, 150).replace(/\s+/g, " "));

  const pending0 = await evalJs(`document.querySelectorAll("button[aria-label='Completar tarea']").length`);
  await rpc(ws, "Runtime.evaluate", { expression: `(() => { const b=document.querySelector("button[aria-label='Completar tarea']"); if(b)b.click(); return !!b; })()`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 900));
  const pending1 = await evalJs(`document.querySelectorAll("button[aria-label='Completar tarea']").length`);
  console.log("Tareas pendientes antes:", pending0, "| tras completar 1:", pending1);

  await nav(URL); // reload -> resets
  const pending2 = await evalJs(`document.querySelectorAll("button[aria-label='Completar tarea']").length`);
  console.log("Tras recargar (debe igualar 'antes'):", pending2);

  console.log("ERRORES JS:", errors.length);
  if (errors.length) console.log(errors.slice(0, 4).join("\n"));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });