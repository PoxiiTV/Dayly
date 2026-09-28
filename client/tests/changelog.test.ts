import { describe, expect, it } from "vitest";
import { RELEASE_CHANGELOG, compareReleaseVersions, sortReleaseChangelogDesc } from "@/lib/releaseChangelog";

describe("release changelog ordering", () => {
  it("shows every release from newest to oldest even when entries were added out of order", () => {
    const versions = sortReleaseChangelogDesc(RELEASE_CHANGELOG).map((release) => release.version);
    expect(versions[0]).toBe("1.0.142");
    expect(versions.indexOf("1.0.114")).toBeLessThan(versions.indexOf("1.0.113"));
    expect(versions.indexOf("1.0.113")).toBeLessThan(versions.indexOf("1.0.112"));
    expect(versions.every((version, index) => index === 0 || compareReleaseVersions(versions[index - 1]!, version) >= 0)).toBe(true);
  });
});
