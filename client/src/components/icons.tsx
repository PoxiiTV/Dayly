import { APP_NAME } from "@brand";

/** Respects Vite base (`/` in Plesk, `/Dayly/` on GitHub Pages). */
export const brandIconUrl = `${import.meta.env.BASE_URL}brand/icon-192.png`;

export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src={brandIconUrl}
      alt={APP_NAME}
      width={192}
      height={192}
      draggable={false}
      className={"shrink-0 object-contain " + (className ?? "w-7 h-7")}
    />
  );
}
/** @deprecated alias — same mark */
export const Monaco = BrandLogo;
export function SunMoon({ className }: { className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
}