import clsx from "clsx";
import { parseChatPresence, STATUS_META } from "@/lib/chatStatus";

/**
 * The little bead on the corner of a face. Sits inside a `relative` wrapper,
 * with a ring in the surface colour so it reads as a dot on top of the photo
 * rather than a stain in it.
 */
export function StatusDot({ status, size = 12, className }: {
  status?: string | null;
  /** Pixels; the badge on a 40px face wants more than the one on a 24px face. */
  size?: number;
  className?: string;
}) {
  const meta = STATUS_META[parseChatPresence(status)];
  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      style={{ width: size, height: size }}
      className={clsx("absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface", meta.dot, className)}
    />
  );
}
