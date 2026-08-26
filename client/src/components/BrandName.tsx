import clsx from "clsx";
import { APP_NAME } from "@brand";

type BrandNameProps = {
  className?: string;
};

/** Renders Dayly with the brand styling. */
export function BrandName({ className }: BrandNameProps) {
  return (
    <span className={clsx("font-bold tracking-tight text-text", className)} style={{ letterSpacing: "-0.02em" }} aria-label={APP_NAME}>
      {APP_NAME}
    </span>
  );
}
