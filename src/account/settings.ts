/**
 * CODER CLI — privacy settings store.
 *
 * Local mirror of the account's privacy settings (~/.coder/settings.json),
 * used to gate prompt/response recording and training opt-in even when
 * offline. Defaults: history ON, training OFF.
 */

import { privacySettingsSchema, type PrivacySettings } from "../../shared/src/index.js";
import { paths, readJson, writeJson } from "../utils/paths.js";

export const DEFAULT_PRIVACY: PrivacySettings = { historyEnabled: true, trainingOptIn: false };

export function settingsPath(): string {
  return paths.settings();
}

export function loadSettings(): PrivacySettings {
  const raw = readJson<unknown>(settingsPath());
  if (raw === undefined) return { ...DEFAULT_PRIVACY };
  const parsed = privacySettingsSchema.safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_PRIVACY };
  return parsed.data;
}

export function saveSettings(settings: PrivacySettings): PrivacySettings {
  writeJson(settingsPath(), settings, { mode: 0o600 });
  return settings;
}

export function updateSettings(patch: Partial<PrivacySettings>): PrivacySettings {
  const next = { ...loadSettings(), ...patch };
  return saveSettings(next);
}

/**
 * A "privacy profile" toggle used by `coder settings privacy on|off`.
 *   on  → maximum privacy: no history recording, no training data
 *   off → standard: back to safe defaults (history on, training off —
 *         re-consent is required to collect training data again)
 */
export function setPrivacyProfile(enabled: boolean): PrivacySettings {
  if (enabled) {
    return updateSettings({ historyEnabled: false, trainingOptIn: false });
  }
  return updateSettings({ historyEnabled: true, trainingOptIn: false });
}
