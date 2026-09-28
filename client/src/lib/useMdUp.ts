import { useEffect, useState } from "react";

const QUERY = "(min-width: 768px)";

/** True from Tailwind's `md` breakpoint up: phone layouts branch on `!useMdUp()`. */
export function useMdUp(): boolean {
  const [md, setMd] = useState(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setMd(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return md;
}
