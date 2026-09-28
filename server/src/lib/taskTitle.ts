/**
 * Roughly five lines of a board card. Quick capture is "type, Enter", so a
 * long thought typed as the title is split instead of rejected: the head
 * stays as the title and the rest continues in the description.
 */
export const TASK_TITLE_SOFT_LIMIT = 150;

export function splitLongTaskTitle(
  title: string,
  description?: string | null,
): { title: string; description: string | null } {
  const clean = title.trim();
  if (clean.length <= TASK_TITLE_SOFT_LIMIT) return { title: clean, description: description ?? null };
  const existing = description?.trim() ? description : null;

  // Cut on a word boundary unless that would leave a very short title.
  const space = clean.lastIndexOf(" ", TASK_TITLE_SOFT_LIMIT);
  const at = space >= TASK_TITLE_SOFT_LIMIT * 0.6 ? space : TASK_TITLE_SOFT_LIMIT;
  const head = clean.slice(0, at).trimEnd();
  const rest = clean.slice(at).trimStart();
  return {
    title: `${head}…`,
    description: existing ? `…${rest}\n\n${existing}` : `…${rest}`,
  };
}
