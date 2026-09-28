export const SETTINGS_GROUPS = [
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
] as const;

export type SettingsSectionId = (typeof SETTINGS_GROUPS)[number]["sections"][number];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

const SECTION_IDS = new Set<SettingsSectionId>(SETTINGS_GROUPS.flatMap((group) => [...group.sections]));

export function settingsSectionFromHash(hash: string): SettingsSectionId {
  const candidate = hash.replace(/^#/, "").trim().toLowerCase() as SettingsSectionId;
  return SECTION_IDS.has(candidate) ? candidate : DEFAULT_SETTINGS_SECTION;
}

/** A second click closes the section; null is a valid, intentional state. */
export function toggleSettingsSection(open: SettingsSectionId | null, next: SettingsSectionId): SettingsSectionId | null {
  return open === next ? null : next;
}
