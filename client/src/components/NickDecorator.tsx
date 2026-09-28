import { useMemo, useState } from "react";
import clsx from "clsx";
import { Sparkles, Type, Wand2 } from "lucide-react";
import { Input } from "@/components/ui";
import {
  NICK_FONTS, NICK_SYMBOLS,
  applyFont, previewFonts, previewTemplates,
} from "@/lib/nickStyles";
import type { NickFont } from "@/lib/nickStyles";

/**
 * The ornament picker on its own: templates, Unicode alphabets and symbols.
 *
 * Shared by the personal nick and the group name, because decorating a name is
 * the same job in both places — only what you do with the result differs.
 */

type Tab = "plantillas" | "letras" | "simbolos";

const TABS: { id: Tab; label: string; icon: typeof Wand2 }[] = [
  { id: "plantillas", label: "Plantillas", icon: Wand2 },
  { id: "letras", label: "Letras", icon: Type },
  { id: "simbolos", label: "Símbolos", icon: Sparkles },
];

export function NickDecorator({ value, onChange, baseLabel = "Nombre (para los adornos)", basePlaceholder = "Tu nombre" }: {
  /** The text being decorated; templates replace it, letters and symbols stack. */
  value: string;
  onChange: (next: string) => void;
  baseLabel?: string;
  basePlaceholder?: string;
}) {
  const [tab, setTab] = useState<Tab>("plantillas");
  /** The bare word the templates wrap, kept apart from the decorated result. */
  const [base, setBase] = useState(value);

  const templates = useMemo(() => previewTemplates(base), [base]);
  const fonts = useMemo(() => previewFonts(base), [base]);

  const applyLetters = (font: NickFont) => {
    // Applied to what is already there, so a template plus an alphabet stack
    // the way they did in the old generators.
    onChange(applyFont(value.trim() || base, font));
  };

  return (
    <div className="space-y-3">
      <Input
        label={baseLabel}
        value={base}
        onChange={(event) => setBase(event.target.value)}
        placeholder={basePlaceholder}
        maxLength={40}
      />

      <div className="flex gap-1.5" role="tablist" aria-label="Estilos">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "chip chip-sm border inline-flex items-center gap-1.5",
              tab === t.id ? "border-accent text-accent bg-accent/10" : "border-border text-muted hover:border-accent/40",
            )}
          >
            <t.icon className="w-3.5 h-3.5" aria-hidden="true" />{t.label}
          </button>
        ))}
      </div>

      {tab === "plantillas" && (
        <ul className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onChange(t.value)}
                className="w-full text-left rounded-xl border border-border px-3 py-2 text-sm text-text hover:border-accent/50 hover:bg-accent/5 truncate"
              >
                {t.value}
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === "letras" && (
        <ul className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
          {fonts.map((f) => {
            const font = NICK_FONTS.find((x) => x.id === f.id);
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => font && applyLetters(font)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 hover:border-accent/50 hover:bg-accent/5"
                >
                  <span className="text-sm text-text truncate">{f.value}</span>
                  <span className="text-xs text-faint shrink-0">{f.label}</span>
                </button>
              </li>
            );
          })}
          <li className="text-xs text-muted px-1 pt-1">
            Se aplica sobre lo que ya hay, así que puedes combinar un adorno con otras letras.
          </li>
        </ul>
      )}

      {tab === "simbolos" && (
        <div className="max-h-56 overflow-y-auto">
          <div className="flex flex-wrap gap-1">
            {NICK_SYMBOLS.map((sym, i) => (
              <button
                key={`${sym}-${i}`}
                type="button"
                onClick={() => onChange(value + sym)}
                aria-label={`Añadir ${sym}`}
                className="w-9 h-9 grid place-items-center rounded-lg border border-border text-text hover:border-accent/50 hover:bg-accent/5"
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
