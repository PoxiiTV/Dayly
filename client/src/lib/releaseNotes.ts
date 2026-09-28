import { APP_VERSION } from "@brand";
import {
  getPendingReleaseChangelog,
  compareReleaseVersions,
  parseReleaseVersion,
  RELEASE_CHANGELOG,
  type ReleaseChangelog,
} from "@/lib/releaseChangelog";

const SEEN_VERSION_KEY = "dayly.release-notes.seen-version";
const LEGACY_SEEN_PREFIX = "dayly.release-notes.seen.";

function getLastSeenVersion(): string | null {
  try {
    const versions: string[] = [];
    const storedVersion = localStorage.getItem(SEEN_VERSION_KEY);
    if (storedVersion && parseReleaseVersion(storedVersion) && compareReleaseVersions(storedVersion, APP_VERSION) <= 0) {
      versions.push(storedVersion);
    }

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(LEGACY_SEEN_PREFIX) || localStorage.getItem(key) !== "1") continue;
      const version = key.slice(LEGACY_SEEN_PREFIX.length);
      if (parseReleaseVersion(version) && compareReleaseVersions(version, APP_VERSION) <= 0) versions.push(version);
    }

    return versions.reduce<string | null>((highest, version) => {
      if (!highest || compareReleaseVersions(version, highest) > 0) return version;
      return highest;
    }, null);
  } catch {
    return null;
  }
}

export function getPendingReleaseNotes(): readonly ReleaseChangelog[] {
  return getPendingReleaseChangelog(APP_VERSION, getLastSeenVersion());
}

export function markReleaseNotesSeen(): void {
  try {
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
    // Keep the old marker so an older shell does not reopen the same release.
    localStorage.setItem(`${LEGACY_SEEN_PREFIX}${APP_VERSION}`, "1");
  } catch {
    // Private browsing/storage restrictions should not block the app.
  }
}
