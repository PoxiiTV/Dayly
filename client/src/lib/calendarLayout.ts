/** Allocate columns using rendered bounds, including minimum-height reminders. */
export function calendarColumns(blocks: { key: string; top: number; height: number }[]): Map<string, { column: number; columns: number }> {
  const result = new Map<string, { column: number; columns: number }>();
  let group: { key: string; column: number }[] = [];
  let ends: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    for (const item of group) result.set(item.key, { column: item.column, columns: ends.length });
    group = [];
    ends = [];
  };
  for (const block of [...blocks].sort((a, b) => a.top - b.top || b.height - a.height)) {
    if (block.top >= groupEnd) flush();
    let column = ends.findIndex((end) => end <= block.top);
    if (column < 0) column = ends.length;
    ends[column] = block.top + block.height;
    groupEnd = Math.max(...ends);
    group.push({ key: block.key, column });
  }
  flush();
  return result;
}
