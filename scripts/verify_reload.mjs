// Verify: clicking a section then reloading does NOT 404 on GH Pages demo.
const BASE = "https://poxiitv.github.io/Dayly/";
async function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve) => {
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener("message", h); resolve(m); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function main() {
  const pages = await (await fetch(`http://localhost:9222/json`)).json();
  const ws = (await import("node:net")).Socket ? null : null;
  const page = pages.find((p) => p.type === "page");
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (sock.onopen = r));
  await rpc(sock, "Runtime.enable"); await rpc(sock, "Page.enable");
  const ev = async (e) => (await rpc(sock, "Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;

  await rpc(sock, "Page.navigate", { url: BASE });
  await new Promise((r) => setTimeout(r, 4000));
  console.log("Inicio URL:", await ev("location.href"));

  // click "Tareas" in the sidebar (desktop) or bottom bar (mobile). Try text match.
  await rpc(sock, "Runtime.evaluate", { expression: `(() => {
    const els=[...document.querySelectorAll('a')];
    const a=els.find(e=>e.textContent.trim()==='Tareas');
    if(a){a.click(); return true;} return false;
  })()`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 1600));
  console.log("URL tras clic:", await ev("location.href"));
  const bodyTareas = (await ev("document.body.innerText")) ?? "";
  console.log("Pagina Tareas renderizada:", bodyTareas.includes("Nueva tarea") || bodyTareas.includes("Filtros"));

  // RELOAD the current (hash) URL — the exact action that used to 404
  await rpc(sock, "Runtime.evaluate", { expression: `location.reload()` });
  await new Promise((r) => setTimeout(r, 3500));
  console.log("Tras recargar (URL):", await ev("location.href"));
  const bodyAfter = (await ev("document.body.innerText")) ?? "";
  console.log("NO es 404:", !bodyAfter.includes("404"));
  console.log("Sigue en Tareas:", bodyAfter.includes("Filtros") || bodyAfter.includes("Nueva tarea"));
  sock.close();
  process.exit(0);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });