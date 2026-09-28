import { describe, expect, it } from "vitest";
import { getPendingReleaseChangelog, type ReleaseChangelog } from "../../client/src/lib/releaseChangelog.ts";

const changelog: readonly ReleaseChangelog[] = [
  { version: "1.0.1", notes: [{ title: "Uno", body: "" }] },
  { version: "1.0.2", notes: [{ title: "Dos", body: "" }] },
  { version: "1.0.3", notes: [{ title: "Tres", body: "" }] },
];

describe("release changelog", () => {
  it("shows only the current release for a first visit", () => {
    expect(getPendingReleaseChangelog("1.0.3", null, changelog).map((release) => release.version)).toEqual(["1.0.3"]);
  });

  it("shows every release skipped since the last seen version", () => {
    expect(getPendingReleaseChangelog("1.0.3", "1.0.1", changelog).map((release) => release.version)).toEqual(["1.0.2", "1.0.3"]);
  });

  it("shows nothing after the current release has been seen", () => {
    expect(getPendingReleaseChangelog("1.0.3", "1.0.3", changelog)).toEqual([]);
  });
});
