/** Minimal shape the manual board order needs. */
type Ordered = { id: string; boardOrder?: number | null };

/**
 * The user's dragged order wins over the automatic one. Tasks never placed by
 * hand (new ones) keep the automatic order and go first, so nothing new hides
 * at the end of a long board.
 */
export function applyManualOrder<T extends Ordered>(autoSorted: T[]): T[] {
  const free = autoSorted.filter((t) => t.boardOrder == null);
  const placed = autoSorted
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.boardOrder != null)
    .sort((a, b) => a.task.boardOrder! - b.task.boardOrder! || a.index - b.index)
    .map(({ task }) => task);
  return [...free, ...placed];
}

/**
 * A reorder made inside a filtered view, written back into the full list:
 * the visible tasks swap among the slots they already held, everything else
 * stays where it was. Returns the ids of the whole list in their new order.
 */
export function mergeVisibleOrder(allIds: string[], visibleNewOrder: string[]): string[] {
  const visible = new Set(visibleNewOrder);
  const queue = [...visibleNewOrder];
  const merged = allIds.map((id) => (visible.has(id) ? queue.shift()! : id));
  // Visible tasks missing from the full list (should not happen) go at the end.
  return [...merged, ...queue];
}

/**
 * Positions for a reorder inside a view the server already filtered (project,
 * tag, search…): the visible tasks swap the positions they already had, so the
 * tasks outside the view keep their place. Null when some visible task was
 * never placed by hand; then the caller saves the loaded list as a whole.
 */
export function swapPositions(visibleNewOrder: string[], current: Map<string, number | null | undefined>): number[] | null {
  const values = visibleNewOrder.map((id) => current.get(id));
  if (values.some((v) => v == null)) return null;
  return (values as number[]).sort((a, b) => a - b);
}
