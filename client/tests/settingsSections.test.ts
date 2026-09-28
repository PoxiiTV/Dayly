import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_GROUPS,
  settingsSectionFromHash,
  toggleSettingsSection,
} from "@/lib/settingsSections";

describe("settings sections", () => {
  it("keeps the intended professional grouping and order", () => {
    expect(SETTINGS_GROUPS).toEqual([
      {
        id: "preferences",
        label: "Preferencias",
        sections: ["general", "appearance", "sound", "chat", "mascot"],
      },
      {
        id: "services",
        label: "Servicios",
        sections: ["browser", "integrations"],
      },
    ]);

    const ids = SETTINGS_GROUPS.flatMap((group) => [...group.sections]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens General by default", () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe("general");
    expect(settingsSectionFromHash("")).toBe("general");
    expect(settingsSectionFromHash("#unknown")).toBe("general");
  });

  it("maps direct section hashes, including the existing mascot link", () => {
    expect(settingsSectionFromHash("#appearance")).toBe("appearance");
    expect(settingsSectionFromHash("#sound")).toBe("sound");
    expect(settingsSectionFromHash("#mascot")).toBe("mascot");
    expect(settingsSectionFromHash("#integrations")).toBe("integrations");
  });

  it("allows every section to be closed", () => {
    expect(toggleSettingsSection("general", "general")).toBeNull();
    expect(toggleSettingsSection(null, "sound")).toBe("sound");
    expect(toggleSettingsSection("appearance", "sound")).toBe("sound");
  });
});
