import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * A photo at a size worth looking at, over everything else.
 *
 * Its own portal on purpose: the dialog shell that opens it declares
 * `will-change: transform`, which would make a `fixed` child position itself
 * against the shell instead of the screen. Escape is caught in the CAPTURE
 * phase and stopped there, because the dialog underneath listens for Escape on
 * `window` too and one key press would otherwise close both.
 */
export function PhotoZoom({ src, alt, onClose, size = "avatar" }: {
  src: string;
  alt: string;
  onClose: () => void;
  size?: "avatar" | "attachment";
}) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        // The close button is the only control in this dialog.
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    // Mounted after the floating chat (also z=119), but below the PIN gate (z=120).
    <div
      className="fixed inset-0 z-[119] grid place-items-center bg-black/85 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Vista ampliada: ${alt}`}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <button
        ref={closeButton}
        type="button"
        onClick={onClose}
        aria-label="Cerrar imagen ampliada"
        className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      {/* Avatars are stored 256 px square, so natural size would be a small
          picture on a big screen: it is scaled up to a size worth opening. */}
      <img
        src={src}
        alt={alt}
        className={size === "attachment"
          ? "w-[min(90vw,960px)] max-h-[calc(100dvh-4rem)] max-w-full rounded-lg object-contain"
          : "w-[min(78vw,360px)] max-h-[calc(100dvh-4rem)] max-w-full rounded-2xl object-contain"}
      />
    </div>,
    document.body,
  );
}
