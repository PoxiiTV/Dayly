import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
import { useTheme, useThemeWave } from "@/lib/theme";

/** Light/dark toggle for login and other public screens. */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { resolved } = useTheme();
  const themeWave = useThemeWave();
  const toLight = resolved === "dark";
  return (
    <button
      type="button"
      onClick={(e) => themeWave(toLight ? "LIGHT" : "DARK", e)}
      aria-label={toLight ? "Usar tema claro" : "Usar tema oscuro"}
      title={toLight ? "Tema claro" : "Tema oscuro"}
      className={clsx("btn-ghost btn-icon", className)}
    >
      {toLight ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
