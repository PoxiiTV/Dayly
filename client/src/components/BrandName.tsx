import clsx from "clsx";
import { APP_NAME } from "@brand";

type BrandNameProps = {
  className?: string;
  /** Sidebar / light surfaces */
  variant?: "default" | "onDark";
};

/** Renders Dayly with the brand styling. */
export function BrandName({ className, variant = "default" }: BrandNameProps) {
  const tone = variant === "onDark" ? "text-white" : "text-text";
  return (
    <span className={clsx("font-bold tracking-tight", tone, className)} style={{ letterSpacing: "-0.02em" }} aria-label={APP_NAME}>
      {APP_NAME}
    </span>
  );
}
