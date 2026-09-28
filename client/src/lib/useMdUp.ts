import { useEffect, useState } from "react";

/** Live `matchMedia` result, for layouts that must mount one branch only. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

/** True from Tailwind's `md` breakpoint up: phone layouts branch on `!useMdUp()`. */
export function useMdUp(): boolean {
  return useMediaQuery("(min-width: 768px)");
}
