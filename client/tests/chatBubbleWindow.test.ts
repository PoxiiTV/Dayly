import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getNativeChatBubbleBounds,
  NATIVE_CHAT_BUBBLE_DRAG_THRESHOLD,
  getNativeChatBubbleDragOrigin,
  getNativeChatBubbleDragPosition,
  createNativeChatBubbleMoveQueue,
  hasNativeChatBubbleDragThreshold,
  isPrimaryNativeChatBubblePointer,
} from "../src/pages/ChatBubbleWindow";
import {
  getNativeChatBubbleState,
  isValidNativeChatBubblePosition,
  moveNativeChatBubble,
  parseNativeChatBubbleState,
  physicalToLogicalWindowPosition,
  showNativeChatBubbleMenu,
  startNativeChatBubbleDragging,
  watchNativeWindowMoved,
} from "../src/lib/nativeShell";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
});

describe("native chat bubble state recovery", () => {
  it("recovers an open state through the query when the open event was missed", async () => {
    const invoke = vi.fn(async (command: string) => command === "chat_bubble_state"
      ? { visible: true, mode: "panel", reason: "open", futureMode: "kept" }
      : null);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: { invoke } } as unknown as Window,
    });

    await expect(getNativeChatBubbleState()).resolves.toMatchObject({ visible: true, mode: "panel", reason: "open", futureMode: "kept" });
    expect(invoke).toHaveBeenCalledWith("chat_bubble_state");
  });

  it("keeps the typed reason and rejects malformed event payloads", () => {
    const state = parseNativeChatBubbleState({ visible: false, mode: "bubble", reason: "tray", closed: true, extra: 1 });
    expect(state).toMatchObject({ visible: false, mode: "bubble", reason: "tray", closed: true, extra: 1 });
    expect(parseNativeChatBubbleState({ visible: true, mode: "wrong", reason: "open" })).toBeNull();
  });
});

describe("native chat bubble bounds", () => {
  it("expands a 72px bubble into a useful panel on the same screen", () => {
    const panel = getNativeChatBubbleBounds("panel", {
      width: 72,
      height: 72,
      screenX: 1720,
      screenY: 960,
      availableWidth: 1920,
      availableHeight: 1080,
      availableLeft: 0,
      availableTop: 0,
    });
    expect(panel.width).toBe(380);
    expect(panel.height).toBe(620);
    expect(panel.left).toBe(1412);
    expect(panel.top).toBe(404);
  });

  it("opens the panel towards the screen centre when the bubble sits on the left", () => {
    const panel = getNativeChatBubbleBounds("panel", {
      width: 72,
      height: 72,
      screenX: 40,
      screenY: 960,
      availableWidth: 1920,
      availableHeight: 1080,
      availableLeft: 0,
      availableTop: 0,
    });
    expect(panel.left).toBe(40);
    expect(panel.top).toBe(404);
  });

  it("keeps stored positions separate from the browser bubble and rejects unsafe values", () => {
    expect(NATIVE_CHAT_BUBBLE_DRAG_THRESHOLD).toBe(8);
    expect(isValidNativeChatBubblePosition({ mode: "bubble", left: 12, top: 24, width: 72, height: 72 })).toBe(true);
    expect(isValidNativeChatBubblePosition({ mode: "bubble", left: 100_001, top: 24, width: 72, height: 72 })).toBe(false);
    expect(isValidNativeChatBubblePosition({ mode: "panel", left: 12, top: 24, width: 280, height: 240 })).toBe(true);
  });
});

describe("native chat bubble pointer actions", () => {
  it("keeps left click and drag separate from right click", () => {
    expect(isPrimaryNativeChatBubblePointer("mouse", 0)).toBe(true);
    expect(isPrimaryNativeChatBubblePointer("mouse", 2)).toBe(false);
    expect(isPrimaryNativeChatBubblePointer("touch", 0)).toBe(true);
    expect(hasNativeChatBubbleDragThreshold(10, 10, 17, 10)).toBe(false);
    expect(hasNativeChatBubbleDragThreshold(10, 10, 18, 10)).toBe(true);
    expect(getNativeChatBubbleDragPosition(120, 240, 10, 10, 34, 2)).toEqual({ left: 144, top: 232 });
  });

  it("starts each drag from the last visual position instead of stale window bounds", () => {
    const currentBounds = { left: 0, top: 0, width: 72, height: 72 };
    const origin = getNativeChatBubbleDragOrigin({ left: 144, top: 232 }, currentBounds);
    expect(origin).toEqual({ left: 144, top: 232 });
    expect(getNativeChatBubbleDragPosition(origin.left, origin.top, 20, 20, 30, 16)).toEqual({ left: 154, top: 228 });
  });

  it("serializes a sequence of moves and keeps only the latest move while IPC is busy", async () => {
    const frames: Array<() => void> = [];
    const calls: Array<{ left: number; top: number }> = [];
    let releaseFirst: ((ok: boolean) => void) | null = null;
    const queue = createNativeChatBubbleMoveQueue(
      async (position) => {
        calls.push(position);
        if (calls.length === 1) return new Promise<boolean>((resolve) => { releaseFirst = resolve; });
        return true;
      },
      (callback) => {
        frames.push(callback);
        return frames.length;
      },
    );

    queue.queue({ left: 100, top: 200 });
    queue.queue({ left: 110, top: 210 });
    frames.shift()?.();
    expect(calls).toEqual([{ left: 110, top: 210 }]);

    queue.queue({ left: 120, top: 220 });
    expect(frames).toHaveLength(0);
    releaseFirst?.(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(frames).toHaveLength(1);
    frames.shift()?.();
    await Promise.resolve();
    expect(calls).toEqual([{ left: 110, top: 210 }, { left: 120, top: 220 }]);
  });

  it("waits for the final move before reporting a finished drag", async () => {
    const frames: Array<() => void> = [];
    const calls: Array<{ left: number; top: number }> = [];
    let releaseFirst: ((ok: boolean) => void) | null = null;
    let releaseFinal: ((ok: boolean) => void) | null = null;
    const queue = createNativeChatBubbleMoveQueue(
      (position) => {
        calls.push(position);
        return new Promise<boolean>((resolve) => {
          if (calls.length === 1) releaseFirst = resolve;
          else releaseFinal = resolve;
        });
      },
      (callback) => { frames.push(callback); return frames.length; },
    );

    queue.queue({ left: 100, top: 200 });
    frames.shift()?.();
    const finished = queue.finish({ left: 140, top: 240 });
    let settled = false;
    void finished.then(() => { settled = true; });
    expect(calls).toEqual([{ left: 100, top: 200 }]);
    releaseFirst?.(true);
    await Promise.resolve();
    expect(calls).toEqual([{ left: 100, top: 200 }, { left: 140, top: 240 }]);
    expect(settled).toBe(false);
    releaseFinal?.(true);
    await expect(finished).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  it("does not report a completed drag when its final native move fails", async () => {
    const queue = createNativeChatBubbleMoveQueue(
      async () => false,
      (callback) => { callback(); return 1; },
    );
    await expect(queue.finish({ left: 140, top: 240 })).resolves.toBe(false);
  });

  it("moves through the child-only command and reports invoke failures", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "move_chat_bubble") {
        expect(args).toEqual({ left: 144, top: 232 });
        return null;
      }
      throw new Error("unexpected command");
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: { invoke } } as unknown as Window,
    });

    await expect(moveNativeChatBubble(144, 232)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("move_chat_bubble", { left: 144, top: 232 });

    invoke.mockRejectedValueOnce(new Error("old shell"));
    await expect(moveNativeChatBubble(144, 232)).resolves.toBe(false);
  });

  it("opens the native menu and fails closed when the shell APIs are unavailable", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "show_chat_bubble_menu") return null;
      throw new Error("unexpected command");
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: { invoke } } as unknown as Window,
    });
    await expect(showNativeChatBubbleMenu()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("show_chat_bubble_menu");

    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    await expect(showNativeChatBubbleMenu()).resolves.toBe(false);
    await expect(startNativeChatBubbleDragging()).resolves.toBe(false);
  });

  it("starts the OS drag and tracks native moves in logical pixels", async () => {
    const startDragging = vi.fn(async () => {});
    let moved: ((event: { payload: { x: number; y: number } }) => void) | null = null;
    const unlisten = vi.fn();
    const onMoved = vi.fn(async (handler: typeof moved) => {
      moved = handler;
      return unlisten;
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        devicePixelRatio: 1.5,
        __TAURI__: { window: { getCurrentWindow: () => ({ startDragging, onMoved }) } },
      } as unknown as Window,
    });

    await expect(startNativeChatBubbleDragging()).resolves.toBe(true);
    expect(startDragging).toHaveBeenCalledOnce();

    const positions: Array<{ left: number; top: number }> = [];
    await expect(watchNativeWindowMoved((position) => positions.push(position))).resolves.toBe(unlisten);
    moved!({ payload: { x: 300, y: 150 } });
    moved!({ payload: { x: Number.NaN, y: 150 } });
    expect(positions).toEqual([{ left: 200, top: 100 }]);
  });

  it("converts physical positions and ignores unusable scale factors", () => {
    expect(physicalToLogicalWindowPosition(250, 125, 1.25)).toEqual({ left: 200, top: 100 });
    expect(physicalToLogicalWindowPosition(250, 125, 0)).toEqual({ left: 250, top: 125 });
    expect(physicalToLogicalWindowPosition(Number.POSITIVE_INFINITY, 0, 1)).toBeNull();
  });

  it("does not watch moves outside the native shell", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const handler = vi.fn();
    const stop = await watchNativeWindowMoved(handler);
    expect(() => stop()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
