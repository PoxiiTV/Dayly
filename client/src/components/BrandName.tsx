import clsx from "clsx";
import { APP_NAME } from "@brand";

type BrandNameProps = {
  className?: string;
  /** Login / brand panel: light coral on navy so Kalen stays readable. */
  variant?: "default" | "onDark";
};

/** Renders Kalendiario with the calendar-logo coral on Kalen. */
export function BrandName({ className, variant = "default" }: BrandNameProps) {
  const kalen =
    variant === "onDark"
      ? { color: "#ffe4e1" }
      : { color: "rgb(var(--brand))" };
  return (
    <span className={clsx("font-bold tracking-tight", className)} style={{ letterSpacing: "-0.02em" }} aria-label={APP_NAME}>
      <span className="text-brand" style={kalen}>Kalen</span>diario
    </span>
  );
}
