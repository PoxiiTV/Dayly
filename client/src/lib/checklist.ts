export type ChecklistItem = { done: boolean; text: string };

const ITEM_RE = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;

export function parseChecklist(content: string): ChecklistItem[] | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const items: ChecklistItem[] = [];
  let saw = false;
  for (const line of lines) {
    const m = ITEM_RE.exec(line);
    if (m) {
      saw = true;
      items.push({ done: m[1] !== " ", text: m[2] });
      continue;
    }
    if (!line.trim()) continue;
    if (saw) return null;
  }
  return saw ? items : null;
}

export function serializeChecklist(items: ChecklistItem[]): string {
  const rows = items.length ? items : [{ done: false, text: "" }];
  return rows.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n");
}

export function linesToChecklist(content: string): ChecklistItem[] {
  const parsed = parseChecklist(content);
  if (parsed) return parsed.length ? parsed : [{ done: false, text: "" }];
  const lines = content.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/^\s*[-*+]\s+(\[[ xX]\]\s?)?/, "").trim()).filter(Boolean);
  if (!lines.length) return [{ done: false, text: "" }];
  return lines.map((text) => ({ done: false, text }));
}

export function isChecklistNote(content: string | null | undefined): boolean {
  if (!content?.trim()) return false;
  return parseChecklist(content) !== null;
}
