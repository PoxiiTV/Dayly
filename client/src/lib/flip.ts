import { flushSync } from "react-dom";

const FLIP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const TASK_MOVE_MS = 500;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Clone the row, update the lists, then slide the clone to the new spot. */
export async function flyTaskRow(fromEl: HTMLElement, taskId: string, update: () => void): Promise<void> {
  const first = fromEl.getBoundingClientRect();
  const clone = fromEl.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-flip-key");
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, {
    position: "fixed",
    left: `${first.left}px`,
    top: `${first.top}px`,
    width: `${first.width}px`,
    margin: "0",
    zIndex: "80",
    pointerEvents: "none",
    boxSizing: "border-box",
    background: "rgb(var(--surface))",
    borderRadius: "12px",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
  });
  document.body.appendChild(clone);

  flushSync(update);
  await nextFrame();

  const dest = document.querySelector<HTMLElement>(`[data-flip-key="${CSS.escape(taskId)}"]`);
  const moved = dest && dest !== fromEl;
  const last = moved ? dest.getBoundingClientRect() : null;
  if (moved) dest.style.visibility = "hidden";

  const dx = last ? last.left - first.left : 0;
  const dy = last ? last.top - first.top : Math.min(320, window.innerHeight - first.bottom - 24);

  try {
    await clone.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: `translate(${dx}px, ${dy}px)` },
      ],
      { duration: TASK_MOVE_MS, easing: FLIP_EASE, fill: "forwards" },
    ).finished;
  } catch {
    /* cancelled */
  }

  clone.remove();
  if (moved) dest.style.visibility = "";
}

const CONFETTI_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7", "#14b8a6"];
const CONFETTI_FRAME_MS = 1000 / 60;

/** Fast pop, then gravity + drag — same model as a party-popper burst. */
export function burstConfetti(origin: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = origin.getBoundingClientRect();
  const cx = box.left + box.width * 0.22;
  const cy = box.top + box.height / 2;
  const count = 22;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement("span");
    bit.className = "task-confetti";
    bit.setAttribute("aria-hidden", "true");
    const round = Math.random() > 0.45;
    const size = 3.5 + Math.random() * 3;
    Object.assign(bit.style, {
      left: `${cx}px`,
      top: `${cy}px`,
      width: `${round ? size : size * 0.55}px`,
      height: `${size}px`,
      borderRadius: round ? "50%" : "1px",
      background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    });
    document.body.appendChild(bit);

    const angle = -Math.PI / 2 + (Math.random() - 0.42) * Math.PI * 0.9;
    let vel = 16 + Math.random() * 10;
    const gravity = 0.9;
    const decay = 0.9;
    const drift = (Math.random() - 0.5) * 0.45;
    const duration = 900 + Math.random() * 280;
    const spin = (Math.random() > 0.5 ? 1 : -1) * (480 + Math.random() * 520);
    const samples = 12;
    const totalFrames = duration / CONFETTI_FRAME_MS;
    let x = 0;
    let y = 0;
    let frame = 0;
    const keyframes: Keyframe[] = [];
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const target = Math.round(t * totalFrames);
      while (frame < target) {
        x += Math.cos(angle) * vel + drift;
        y += Math.sin(angle) * vel + gravity;
        vel *= decay;
        frame += 1;
      }
      const fade = t === 0 ? 0 : t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
      keyframes.push({
        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${spin * t}deg) scale(${t === 0 ? 0.45 : 1})`,
        opacity: fade,
        offset: t,
      });
    }

    const anim = bit.animate(keyframes, {
      duration,
      delay: Math.random() * 40,
      easing: "linear",
      fill: "forwards",
    });
    void anim.finished.then(() => bit.remove()).catch(() => bit.remove());
  }
}
