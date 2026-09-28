import { useEffect, useState } from "react";
import clsx from "clsx";
import { Eraser } from "lucide-react";
import { Button, Modal, Spinner, useToast } from "@/components/ui";
import { NickText, SubnickText } from "@/components/NickText";
import { NickDecorator } from "@/components/NickDecorator";
import { NickColorPicker } from "@/components/NickColorPicker";
import { NickField } from "@/components/NickField";
import { NICK_MAX, SUBNICK_MAX, nickLength } from "@/lib/nickStyles";
import {
  segmentsLength, segmentsToText, textToSegments, type NickSegment,
} from "@/lib/nickSegments";

export function NickGenerator({ open, onClose, name, initial, onSave }: {
  open: boolean;
  onClose: () => void;
  /** The account name, used as the starting point and as the fallback preview. */
  name: string;
  initial: { nick: string | null; nickColor: string | null; nickBold: boolean; subnick: string | null; nickSegments?: NickSegment[] | null };
  onSave: (value: { nick: string | null; nickColor: string | null; nickBold: boolean; subnick: string | null; nickSegments: NickSegment[] | null }) => Promise<void>;
}) {
  const { push } = useToast();
  /** The pieces are the truth; the plain nick is derived from them. */
  const [pieces, setPieces] = useState<NickSegment[]>(
    () => initial.nickSegments?.length ? initial.nickSegments : textToSegments(initial.nick ?? "", initial.nickColor),
  );
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [bold, setBold] = useState(initial.nickBold);
  const [subnick, setSubnick] = useState(initial.subnick ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPieces(initial.nickSegments?.length ? initial.nickSegments : textToSegments(initial.nick ?? "", initial.nickColor));
    setSelection(null);
    setBold(initial.nickBold);
    setSubnick(initial.subnick ?? "");
  }, [open, name, initial.nick, initial.nickColor, initial.nickBold, initial.subnick]);

  const nick = segmentsToText(pieces);
  const length = segmentsLength(pieces);
  const subLength = nickLength(subnick);
  const tooLong = length > NICK_MAX;
  const subTooLong = subLength > SUBNICK_MAX;

  const save = async () => {
    if (tooLong || subTooLong) { push("error", "El nick o la frase se pasan de largo."); return; }
    setBusy(true);
    try {
      const trimmed = nick.trim();
      await onSave({
        nick: trimmed || null,
        // The server works out the single colour from the pieces, so nothing
        // has to be kept in step by hand here.
        nickColor: null,
        nickBold: bold,
        subnick: subnick.trim() || null,
        nickSegments: trimmed ? pieces : null,
      });
      onClose();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar el nick.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generador de nicks"
      description="Como los de siempre: elige un adorno, cambia las letras y añade tu frase."
      size="xl"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => void save()} disabled={busy || tooLong || subTooLong}>{busy ? <Spinner /> : "Guardar nick"}</Button>
      </>}
    >
      <div className="space-y-5">
        {/* Live preview, the way it will look in the sidebar and the chat. */}
        <div className="rounded-2xl border border-border bg-bg p-4 space-y-1">
          <p className="text-xs uppercase tracking-wide text-faint">Vista previa</p>
          <NickText name={name} nick={nick} segments={pieces} bold={bold} className="block truncate text-lg" />
          <SubnickText subnick={subnick} />
        </div>

        <div className="grid gap-3">
          <div className="space-y-1.5">
            <span className="label">Nick</span>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <NickField
                  segments={pieces}
                  onChange={setPieces}
                  onSelection={setSelection}
                  placeholder="Se rellena al elegir un adorno"
                  ariaLabel="Nick"
                />
              </div>
              <button
                type="button"
                onClick={() => { setPieces([]); setSelection(null); }}
                aria-label="Vaciar el nick"
                title="Vaciar"
                className="btn-ghost btn-icon-sm text-faint hover:text-danger shrink-0"
              >
                <Eraser className="w-4 h-4" />
              </button>
            </div>
            <p className={clsx("text-xs", tooLong ? "text-danger" : "text-faint")}>
              {length}/{NICK_MAX} caracteres{nick.trim() ? "" : " · vacío = se muestra tu nombre"}
            </p>
          </div>
        </div>

        <NickColorPicker
          segments={pieces}
          onChange={setPieces}
          selection={selection}
          bold={bold}
          onBold={setBold}
        />

        <NickDecorator
          value={nick}
          onChange={(next) => setPieces(textToSegments(next))}
          baseLabel="Tu nombre (para los adornos)"
          basePlaceholder="Tu nombre"
        />

        <div className="space-y-1.5">
          <span className="label">Frase de debajo (subnick)</span>
          <input
            value={subnick}
            onChange={(e) => setSubnick(e.target.value)}
            placeholder="Escuchando: Bon Jovi - It's My Life"
            className="input w-full"
            aria-label="Subnick"
          />
          <p className={clsx("text-xs", subTooLong ? "text-danger" : "text-faint")}>
            {subLength}/{SUBNICK_MAX} caracteres · la ven tus amigos del chat
          </p>
        </div>
      </div>
    </Modal>
  );
}
