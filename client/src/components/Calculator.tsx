import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { compute, percentValue, type CalcOp } from "@/lib/calc";

type Op = CalcOp;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const s = n.toPrecision(12).replace(/\.?0+$/, "");
  return s.length > 14 ? n.toExponential(6) : s;
}

export function Calculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [display, setDisplay] = useState("0");
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<Op>(null);
  const [fresh, setFresh] = useState(true);

  const reset = useCallback(() => {
    setDisplay("0");
    setAcc(null);
    setOp(null);
    setFresh(true);
  }, []);

  const applyOp = useCallback((next: Op) => {
    const cur = Number(display);
    if (!Number.isFinite(cur)) { reset(); return; }
    if (acc === null || op === null || fresh) {
      setAcc(cur);
    } else {
      const result = compute(acc, cur, op);
      setAcc(result);
      setDisplay(fmt(result));
    }
    setOp(next);
    setFresh(true);
  }, [acc, display, fresh, op, reset]);

  const equals = useCallback(() => {
    if (op === null || acc === null) return;
    const cur = Number(display);
    const result = compute(acc, cur, op);
    setDisplay(fmt(result));
    setAcc(null);
    setOp(null);
    setFresh(true);
  }, [acc, display, op]);

  const inputDigit = useCallback((d: string) => {
    setDisplay((v) => {
      if (fresh) {
        setFresh(false);
        return d === "." ? "0." : d;
      }
      if (d === "." && v.includes(".")) return v;
      if (v === "0" && d !== ".") return d;
      if (v.replace(".", "").length >= 12) return v;
      return v + d;
    });
  }, [fresh]);

  const backspace = useCallback(() => {
    if (fresh) return;
    setDisplay((v) => (v.length <= 1 || (v.length === 2 && v.startsWith("-")) ? "0" : v.slice(0, -1)));
  }, [fresh]);

  /**
   * A percentage is only a plain division when it stands alone. After `+` or
   * `-` it means "this much of the first number", so 100 + 21 % is 121, not
   * 100 + 0,21. After `x` or `/` the fraction itself is what multiplies.
   */
  const percent = useCallback(() => {
    const cur = Number(display);
    if (!Number.isFinite(cur)) { reset(); return; }
    setDisplay(fmt(percentValue(acc, op, cur)));
    setFresh(true);
  }, [acc, display, op, reset]);

  const negate = useCallback(() => {
    setDisplay((v) => (v === "0" ? v : v.startsWith("-") ? v.slice(1) : `-${v}`));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") { e.preventDefault(); inputDigit(e.key); return; }
      if (e.key === "." || e.key === ",") { e.preventDefault(); inputDigit("."); return; }
      if (e.key === "Backspace") { e.preventDefault(); backspace(); return; }
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "Enter" || e.key === "=") { e.preventDefault(); equals(); return; }
      if (e.key === "+") { e.preventDefault(); applyOp("+"); return; }
      if (e.key === "-") { e.preventDefault(); applyOp("-"); return; }
      if (e.key === "*") { e.preventDefault(); applyOp("*"); return; }
      if (e.key === "/") { e.preventDefault(); applyOp("/"); return; }
      if (e.key === "%") { e.preventDefault(); percent(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, inputDigit, backspace, equals, applyOp, percent, onClose]);

  const keys: { label: string; onClick: () => void; wide?: boolean; accent?: boolean; muted?: boolean }[] = [
    { label: "C", onClick: reset, muted: true },
    { label: "±", onClick: negate, muted: true },
    { label: "%", onClick: percent, muted: true },
    { label: "÷", onClick: () => applyOp("/"), accent: true },
    { label: "7", onClick: () => inputDigit("7") },
    { label: "8", onClick: () => inputDigit("8") },
    { label: "9", onClick: () => inputDigit("9") },
    { label: "×", onClick: () => applyOp("*"), accent: true },
    { label: "4", onClick: () => inputDigit("4") },
    { label: "5", onClick: () => inputDigit("5") },
    { label: "6", onClick: () => inputDigit("6") },
    { label: "−", onClick: () => applyOp("-"), accent: true },
    { label: "1", onClick: () => inputDigit("1") },
    { label: "2", onClick: () => inputDigit("2") },
    { label: "3", onClick: () => inputDigit("3") },
    { label: "+", onClick: () => applyOp("+"), accent: true },
    { label: "0", onClick: () => inputDigit("0"), wide: true },
    { label: ",", onClick: () => inputDigit(".") },
    { label: "=", onClick: equals, accent: true },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Calculadora" size="sm">
      <div className="space-y-3">
        <div className="h-14 rounded-xl bg-bg border border-border px-4 grid items-center justify-end text-2xl font-semibold tabular-nums text-text overflow-hidden">
          {display.replace(".", ",")}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {keys.map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={k.onClick}
              className={
                k.wide ? "col-span-2 h-11 rounded-xl text-sm font-semibold bg-surface border border-border text-text hover:border-accent/40" :
                k.accent ? "h-11 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent-strong" :
                k.muted ? "h-11 rounded-xl text-sm font-semibold bg-bg border border-border text-muted hover:text-text" :
                "h-11 rounded-xl text-sm font-semibold bg-surface border border-border text-text hover:border-accent/40"
              }
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint text-center">Alt+C para abrir o cerrar</p>
      </div>
    </Modal>
  );
}

