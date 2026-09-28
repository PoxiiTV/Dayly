export type CalcOp = "+" | "-" | "*" | "/" | null;

/**
 * What the % key produces, given the pending operation.
 *
 * Every desk calculator reads a percentage against the number it is being
 * added to or subtracted from: `100 + 21 %` is 121, not 100,21. With `x` and
 * `/` the percentage is the plain fraction, so `200 x 10 %` is 20. On its own
 * it is just a division by a hundred.
 */
export function percentValue(acc: number | null, op: CalcOp, current: number): number {
  const relativeToAcc = acc !== null && (op === "+" || op === "-");
  return relativeToAcc ? (acc * current) / 100 : current / 100;
}

/** The four operations, with division by zero left to the caller to format. */
export function compute(a: number, b: number, op: Exclude<CalcOp, null>): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? NaN : a / b;
  }
}
