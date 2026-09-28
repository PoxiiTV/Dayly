import { type ReactNode } from "react";
import clsx from "clsx";
import type { MascotId, MascotMood } from "@/lib/mascotCharacters";

function KawaiiFace({ mood, eyeY = 42, mouthY = 54 }: { mood: MascotMood; eyeY?: number; mouthY?: number }) {
  return (
    <g>
      <g className="mascot-blink">
        <circle cx="28" cy={eyeY} r="4.2" fill="#27272a" />
        <circle cx="44" cy={eyeY} r="4.2" fill="#27272a" />
        <circle cx="29.2" cy={eyeY - 1.4} r="1.3" fill="white" />
        <circle cx="45.2" cy={eyeY - 1.4} r="1.3" fill="white" />
      </g>
      <ellipse cx="24" cy={eyeY + 6} rx="4" ry="2.2" fill="#fda4af" opacity="0.8" />
      <ellipse cx="48" cy={eyeY + 6} rx="4" ry="2.2" fill="#fda4af" opacity="0.8" />
      {mood === "thinking" ? (
        <g>
          <circle className="mascot-think-dot" cx="28" cy={mouthY + 2} r="1.8" fill="#71717a" />
          <circle className="mascot-think-dot" cx="36" cy={mouthY + 2} r="1.8" fill="#71717a" style={{ animationDelay: "0.15s" }} />
          <circle className="mascot-think-dot" cx="44" cy={mouthY + 2} r="1.8" fill="#71717a" style={{ animationDelay: "0.3s" }} />
        </g>
      ) : (
        <ellipse cx="36" cy={mouthY} rx="6" ry={mood === "talking" ? 3.2 : 2} fill="#27272a" className={clsx(mood === "talking" && "mascot-talk")} />
      )}
    </g>
  );
}

function SpriteShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 72 72" className={clsx("w-full h-full drop-shadow-md mascot-breathe", className)} aria-hidden>
      {children}
    </svg>
  );
}

function CalenSprite({ mood }: { mood: MascotMood }) {
  return (
    <SpriteShell>
      <rect x="8" y="14" width="56" height="50" rx="12" fill="#ffffff" stroke="#e4e4e7" strokeWidth="2" />
      <rect x="8" y="14" width="56" height="16" rx="12" fill="#f87171" />
      <rect x="8" y="22" width="56" height="8" fill="#f87171" />
      <circle cx="24" cy="14" r="4" fill="#fecaca" />
      <circle cx="48" cy="14" r="4" fill="#fecaca" />
      <text x="36" y="26" textAnchor="middle" fontSize="6.2" fill="white" fontWeight="700" letterSpacing="0.25">KALEN</text>
      <KawaiiFace mood={mood} eyeY={44} mouthY={56} />
      <path d="M6 32c-4 6 1 10 4 6" fill="#86efac" />
      <path d="M66 36c4 6-1 10-4 6" fill="#86efac" />
    </SpriteShell>
  );
}

function TashiSprite({ mood }: { mood: MascotMood }) {
  return (
    <SpriteShell>
      <rect x="14" y="16" width="44" height="50" rx="8" fill="#fff7ed" stroke="#fdba74" strokeWidth="2" />
      <rect x="25" y="8" width="22" height="14" rx="4" fill="#fb923c" />
      <rect x="30" y="11" width="12" height="5" rx="2" fill="#fed7aa" />
      <rect x="22" y="50" width="7" height="7" rx="1.5" fill="#86efac" />
      <path d="M23.6 53.4 l2.1 2.1 3.6-3.8" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <rect x="32" y="52" width="18" height="3" rx="1.5" fill="#fdba74" />
      <rect x="22" y="60" width="7" height="7" rx="1.5" fill="#fff7ed" stroke="#fdba74" strokeWidth="1.4" />
      <rect x="32" y="62" width="14" height="3" rx="1.5" fill="#fed7aa" />
      <KawaiiFace mood={mood} eyeY={36} mouthY={46} />
      <path d="M10 40c-4 6 1 10 4 6" fill="#86efac" />
      <path d="M62 34c4 6-1 10-4 6" fill="#86efac" />
    </SpriteShell>
  );
}

const NUBO_IMAGE = `${import.meta.env.BASE_URL}mascots/nubo.png`;

function NuboSprite() {
  return (
    <div className="h-full w-full scale-[1.24]">
      <img
        src={NUBO_IMAGE}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-full w-full object-contain drop-shadow-md mascot-breathe"
      />
    </div>
  );
}

/** Posti keeps the former Nubo sticky-note sprite as a separate mascot. */
function PostiSprite({ mood }: { mood: MascotMood }) {
  return (
    <SpriteShell>
      <rect x="12" y="14" width="48" height="48" rx="7" fill="#fde68a" stroke="#fbbf24" strokeWidth="2" />
      <path d="M47 14h13v13L47 14z" fill="#f59e0b" />
      <path d="M47 14v13h13" fill="none" stroke="#d97706" strokeWidth="1.2" />
      <rect x="20" y="50" width="22" height="2.2" rx="1" fill="#f59e0b" opacity="0.45" />
      <rect x="20" y="55" width="16" height="2.2" rx="1" fill="#f59e0b" opacity="0.35" />
      <KawaiiFace mood={mood} eyeY={36} mouthY={46} />
      <circle cx="22" cy="14" r="3.5" fill="#f9a8d4" />
      <path d="M8 34c-4 6 1 10 4 6" fill="#86efac" />
      <path d="M64 38c4 6-1 10-4 6" fill="#86efac" />
    </SpriteShell>
  );
}

function FocoSprite({ mood }: { mood: MascotMood }) {
  return (
    <SpriteShell>
      <ellipse cx="36" cy="42" rx="24" ry="22" fill="#f87171" stroke="#ef4444" strokeWidth="2" />
      <path d="M30 16c2-6 10-8 14-3 2 3-1 7-5 7-3 0-5-2-4-5" fill="#4ade80" />
      <path d="M36 12c1-5 8-6 10-1 1 3-2 6-5 5" fill="#86efac" />
      <path d="M28 18c-4-1-6 4-3 7 3 2 6-1 5-4" fill="#22c55e" />
      <KawaiiFace mood={mood} eyeY={42} mouthY={54} />
    </SpriteShell>
  );
}

const ORBI_IMAGES: Record<MascotMood, string> = {
  idle: `${import.meta.env.BASE_URL}mascots/orbi-idle.png`,
  thinking: `${import.meta.env.BASE_URL}mascots/orbi-thinking.png`,
  talking: `${import.meta.env.BASE_URL}mascots/orbi-talking.png`,
};

function OrbiSprite({ mood }: { mood: MascotMood }) {
  return (
    <img
      src={ORBI_IMAGES[mood]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="h-full w-full scale-[1.05] object-contain drop-shadow-md mascot-breathe"
    />
  );
}

export function MascotSprite({ id, mood }: { id: MascotId; mood: MascotMood }) {
  switch (id) {
    case "calen":
      return <CalenSprite mood={mood} />;
    case "tashi":
      return <TashiSprite mood={mood} />;
    case "nubo":
      return <NuboSprite />;
    case "foco":
      return <FocoSprite mood={mood} />;
    case "posti":
      return <PostiSprite mood={mood} />;
    case "orbi":
      return <OrbiSprite mood={mood} />;
    default: {
      const _never: never = id;
      return _never;
    }
  }
}
