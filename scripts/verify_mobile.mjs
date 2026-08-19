// Verify the mobile drawer menu shows ALL sections + Ajustes and navigates.
const BASE = "https://poxiitv.github.io/Dayly/";
async function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((res) => {
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener("message", h); res(m); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function main() {
  const pages = await (await fetch("http://localhost:9222/json")).json();
  const page = pages.find((p) => p.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await rpc(ws, "Runtime.enable"); await rpc(ws, "Page.enable");
  // mobile viewport
  await rpc(ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const ev = async (e) => (await rpc(ws, "Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;

  await rpc(ws, "Page.navigate", { url: BASE });
  await new Promise((r) => setTimeout(r, 4000));

  console.log("URL:", await ev("location.href"));
  console.log("Bottom nav tiene 'Más':", (await ev("document.body.innerText")).includes("Más"));
  console.log("Hamburguesa visible:", await ev(`!!document.querySelector("button[aria-label='Abrir menú']")`));

  // open the drawer
  await rpc(ws, "Runtime.evaluate", { expression: `document.querySelector("button[aria-label='Abrir menú']").click()` });
  await new Promise((r) => setTimeout(r, 700));
  const drawerText = (await ev("document.body.innerText")) ?? "";
  for (const s of ["Proyectos", "Notas", "Hábitos", "Objetivos", "Estadísticas", "Recordatorios", "Papelera", "Bandeja de entrada", "Ajustes", "Perfil", "Ayuda", "Cerrar sesión"]) {
    console.log("  menú contiene '" + s + "':", drawerText.includes(s));
  }

  // click Ajustes and confirm navigation
  const clicked = await ev(`(() => { const a=[...document.querySelectorAll('a')].find(x=>x.textContent.trim()==='Ajustes'); if(a){a.click(); return true;} return false; })()`);
  await new Promise((r) => setTimeout(r, 1200));
  console.log("Clic Ajustes:", clicked, "| URL:", await ev("location.href"));
  console.log("Pagina Ajustes:", ((await ev("document.body.innerText")) ?? "").includes("Apariencia") || ((await ev("document.body.innerText")) ?? "").includes("Seguridad"));

  ws.close(); process.exit(0);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });