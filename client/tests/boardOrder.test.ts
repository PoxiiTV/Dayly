import { describe, expect, it } from "vitest";
import { applyManualOrder, mergeVisibleOrder, swapPositions } from "../src/lib/boardOrder";

describe("manual board order", () => {
  it("keeps the automatic order when nothing was dragged", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(applyManualOrder(list).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("lets the dragged order win and puts new tasks first", () => {
    const list = [
      { id: "urgent-new", boardOrder: null },
      { id: "a", boardOrder: 2 },
      { id: "b", boardOrder: 0 },
      { id: "c", boardOrder: 1 },
    ];
    expect(applyManualOrder(list).map((t) => t.id)).toEqual(["urgent-new", "b", "c", "a"]);
  });

  it("writes a filtered reorder back into the slots those tasks held", () => {
    // Full board a b c d e; the view shows b and d and the user puts d first.
    expect(mergeVisibleOrder(["a", "b", "c", "d", "e"], ["d", "b"])).toEqual(["a", "d", "c", "b", "e"]);
    expect(mergeVisibleOrder(["a", "b"], ["b", "a"])).toEqual(["b", "a"]);
  });

  it("swaps positions inside a server-filtered view, or gives up when one was never placed", () => {
    const current = new Map<string, number | null>([["b", 4], ["d", 1], ["x", null]]);
    expect(swapPositions(["b", "d"], current)).toEqual([1, 4]);
    expect(swapPositions(["b", "x"], current)).toBeNull();
  });
});
