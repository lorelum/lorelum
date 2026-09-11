import { initializeConfig, type LoadConfigOptions } from "@lorelum/config";
import { defaultBackendConfigSections } from "@lorelum/backend/config";

/** Application composition: collect implemented consumers' defaults without starting any service. */
export function initializeApplicationConfig(options: LoadConfigOptions = {}) {
  return initializeConfig(options, defaultBackendConfigSections());
}
