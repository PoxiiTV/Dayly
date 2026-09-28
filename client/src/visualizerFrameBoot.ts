/**
 * Imported first by the visualizer frame, so it is evaluated before anything
 * else and can report failures that happen while the other modules are still
 * being evaluated — including Butterchurn's own top level.
 *
 * Without this the frame fails silently: its console is easy to miss inside a
 * frame, and the parent would just sit on "preparando el visualizador…".
 */
function report(message: string): void {
  window.parent.postMessage({ type: "visualizer-error", message }, window.location.origin);
}

window.addEventListener("error", (event) => {
  report(event.message || "Error al cargar el visualizador.");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as unknown;
  report(reason instanceof Error ? reason.message : "Fallo al iniciar el visualizador.");
});

// Proof of life: tells "the code never ran" apart from "it ran and failed".
window.parent.postMessage({ type: "visualizer-boot" }, window.location.origin);
