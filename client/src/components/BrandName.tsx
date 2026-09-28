import clsx from "clsx";
import { APP_NAME } from "@brand";

type BrandNameProps = {
  className?: string;
  /** Login / brand panel: white on navy. */
  variant?: "default" | "onDark";
};

/** Renders Dayly with the brand styling. */
export function BrandName({ className, variant = "default" }: BrandNameProps) {
  return (
    <span
      className={clsx("font-bold tracking-tight", variant === "onDark" ? "text-white" : "text-text", className)}
      style={{ letterSpacing: "-0.02em" }}
      aria-label={APP_NAME}
    >
      {APP_NAME}
    </span>
  );
}
