import { describe, expect, it } from "vitest";
import { splitLongTaskTitle, TASK_TITLE_SOFT_LIMIT } from "../src/lib/taskTitle.js";

describe("splitLongTaskTitle", () => {
  it("keeps short titles and their description untouched", () => {
    expect(splitLongTaskTitle("  Comprar pan  ", "notas")).toEqual({ title: "Comprar pan", description: "notas" });
    expect(splitLongTaskTitle("x".repeat(TASK_TITLE_SOFT_LIMIT))).toEqual({ title: "x".repeat(TASK_TITLE_SOFT_LIMIT), description: null });
  });

  it("moves the overflow to the description on a word boundary", () => {
    const words = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(" ");
    const { title, description } = splitLongTaskTitle(words);
    expect(title.length).toBeLessThanOrEqual(TASK_TITLE_SOFT_LIMIT + 1);
    expect(title.endsWith("…")).toBe(true);
    expect(title.slice(0, -1).endsWith(" ")).toBe(false);
    expect(description!.startsWith("…palabra")).toBe(true);
    // Nothing is lost: head + rest rebuild the original text.
    expect(`${title.slice(0, -1)} ${description!.slice(1)}`).toBe(words);
  });

  it("keeps an existing description after the moved text", () => {
    const long = `${"a".repeat(120)} ${"b".repeat(60)}`;
    expect(splitLongTaskTitle(long, "detalle")).toEqual({
      title: `${"a".repeat(120)}…`,
      description: `…${"b".repeat(60)}\n\ndetalle`,
    });
  });

  it("cuts hard when there is no usable space", () => {
    const { title, description } = splitLongTaskTitle("z".repeat(200));
    expect(title).toBe(`${"z".repeat(TASK_TITLE_SOFT_LIMIT)}…`);
    expect(description).toBe(`…${"z".repeat(50)}`);
  });
});
