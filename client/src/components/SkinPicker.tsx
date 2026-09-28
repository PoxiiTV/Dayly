import { useState } from "react";
import { Palette } from "lucide-react";
import clsx from "clsx";
import { Modal } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useSkinWave, useTheme } from "@/lib/theme";
import { SKINS, type SkinId } from "@/lib/skins";

export function SkinPicker() {
  const { applySkin } = useAuth();
  const { skin, resolved } = useTheme();
  const skinWave = useSkinWave();
  const [open, setOpen] = useState(false);
  const current = SKINS.find((item) => item.id === skin) ?? SKINS[0];
  const preview = current.preview[resolved];

  const pick = (id: SkinId, e: React.SyntheticEvent) => {
    skinWave(id, e);
    void applySkin(id);
    setOpen(false);
  };

  return (
    <>
      <p className="text-xs font-medium text-muted mt-5 mb-2">Color</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 rounded-xl border border-border p-2 pr-3 text-left hover:border-accent/40 hover:bg-surface transition-colors"
      >
        <span
          className="w-16 h-12 rounded-lg border border-border shrink-0 p-1.5"
          style={{ background: preview.bg }}
          aria-hidden
        >
          <span
            className="flex h-full items-center gap-1.5 rounded-md px-2"
            style={{ background: preview.surface, boxShadow: `inset 0 0 0 1px ${preview.border}` }}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: preview.accent }} />
            <span className="h-1 flex-1 rounded-full opacity-70" style={{ background: preview.accent }} />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">{current.name}</span>
          <span className="block text-[11px] text-faint">{current.hint}. Pulsa para cambiar de paleta.</span>
        </span>
        <Palette className="w-4 h-4 text-faint shrink-0" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Color de la app"
        description="Elige una paleta. Se aplica al instante."
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SKINS.map((item) => {
            const on = skin === item.id;
            const swatch = item.preview[resolved];
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                onClick={(e) => pick(item.id, e)}
                className={clsx(
                  "text-left rounded-xl border p-2 transition-all",
                  on ? "border-accent bg-accent-soft/60 ring-2 ring-accent/30" : "border-border hover:bg-surface",
                )}
              >
                <span className="block h-12 rounded-lg p-1.5 mb-2" style={{ background: swatch.bg }}>
                  <span
                    className="flex h-full items-center gap-1.5 rounded-md px-2"
                    style={{ background: swatch.surface, boxShadow: `inset 0 0 0 1px ${swatch.border}` }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: swatch.accent }} />
                    <span className="h-1 flex-1 rounded-full opacity-70" style={{ background: swatch.accent }} />
                  </span>
                </span>
                <span className="block text-xs font-medium text-text leading-tight">{item.name}</span>
                <span className="block text-[11px] text-faint">{item.hint}</span>
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
