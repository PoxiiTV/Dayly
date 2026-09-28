import { describe, expect, it } from "vitest";
import {
  reduceFloatingChatNativeState,
  releaseFloatingChatHiddenReason,
  shouldIgnoreStaleFloatingChatClose,
  type FloatingChatNativeSnapshot,
} from "../src/lib/FloatingChat";

const active: FloatingChatNativeSnapshot = {
  active: true,
  expanded: false,
  surface: "native",
  visible: true,
  hiddenReason: null,
};

describe("floating native chat state", () => {
  it("keeps the desired bubble active for tray and PIN hides", () => {
    expect(reduceFloatingChatNativeState(active, { visible: false, mode: "bubble", reason: "tray" })).toMatchObject({
      active: true,
      visible: false,
      hiddenReason: "tray",
    });
    expect(reduceFloatingChatNativeState(active, { visible: false, mode: "bubble", reason: "hide" })).toMatchObject({
      active: true,
      visible: false,
      hiddenReason: "hide",
    });
  });

  it("only deactivates on a real close, not a close event for a reopened window", () => {
    expect(reduceFloatingChatNativeState(active, { visible: false, mode: "bubble", reason: "close" }).active).toBe(false);
    expect(shouldIgnoreStaleFloatingChatClose(true, { visible: true })).toBe(true);
    expect(shouldIgnoreStaleFloatingChatClose(true, { visible: false })).toBe(false);
  });

  it("does not release a tray hide while the PIN gate is still locked", () => {
    expect(releaseFloatingChatHiddenReason("tray", false, true)).toBe("tray");
    expect(releaseFloatingChatHiddenReason("tray", false, false)).toBeNull();
    expect(releaseFloatingChatHiddenReason("hide", false, false)).toBeNull();
  });
});
