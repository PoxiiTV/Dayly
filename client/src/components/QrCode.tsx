import { useMemo } from "react";
import { encode } from "uqr";

export function QrCode({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => encode(value, { ecc: "M", border: 2 }), [value]);
  const path = qr.data
    .flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x} ${y}h1v1h-1z`] : [])))
    .join("");

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      className="mx-auto w-48 h-48 rounded-xl bg-white p-2"
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={path} fill="#0f172a" />
    </svg>
  );
}
