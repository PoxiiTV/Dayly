import clsx from "clsx";
import type { NickSegment } from "@/lib/nickSegments";

/**
 * Renders somebody's display name: the nick when they have one, the account
 * name otherwise, with their colour and weight — and piece by piece when the
 * nick changes colour partway through.
 *
 * Colours arrive as their own fields and their own pieces, never as codes
 * inside the text, so there is nothing to parse and nothing to escape. This is
 * plain text in React nodes, which is exactly why it is safe to show a name
 * another user wrote.
 */
export function NickText({ name, nick, color, bold, segments, className, style }: {
  name: string;
  nick?: string | null;
  color?: string | null;
  bold?: boolean | null;
  /** Coloured pieces; when present they win over `color`. */
  segments?: NickSegment[] | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const shown = nick?.trim() || name;
  const pieces = segments && segments.length ? segments : null;
  return (
    <span
      className={clsx(bold && "font-bold", className)}
      // Only ever a hex colour: the API rejects anything else.
      style={{ ...(!pieces && color ? { color } : {}), ...style }}
      title={shown}
    >
      {pieces
        ? pieces.map((piece, i) => (
          <span key={i} style={piece.c ? { color: piece.c } : undefined}>{piece.t}</span>
        ))
        : shown}
    </span>
  );
}

/** The MSN line under the name. Nothing is rendered when it is empty. */
export function SubnickText({ subnick, className }: { subnick?: string | null; className?: string }) {
  const shown = subnick?.trim();
  if (!shown) return null;
  return (
    <span className={clsx("block truncate text-xs text-muted italic", className)} title={shown}>
      {shown}
    </span>
  );
}
