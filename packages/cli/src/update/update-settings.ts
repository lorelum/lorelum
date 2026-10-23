import { loadConfig, type ConfigDocument, type ConfigReader } from "@lorelum/config";

/** Read only the update settings section; malformed or unreadable settings disable this sidecar. */
export async function loadAutoUpdateSetting(
  readConfig: ConfigReader = loadConfig,
): Promise<boolean> {
  try {
    const document: ConfigDocument = await readConfig();
    if (!("updates" in document)) return true;
    const section: unknown = document.updates;
    if (section === null || typeof section !== "object" || Array.isArray(section)) return false;
    if (!("autoCheck" in section)) return true;
    const enabled: unknown = section.autoCheck;
    return typeof enabled === "boolean" ? enabled : false;
  } catch {
    return false;
  }
}
