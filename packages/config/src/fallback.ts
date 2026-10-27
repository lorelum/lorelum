import { ConfigError } from "./failure";

export type ConfigResolution<T> =
  | { readonly kind: "configured"; readonly value: T }
  | { readonly kind: "fallback"; readonly value: T; readonly error: ConfigError };

/** Loads once and uses only the explicit fallback for a known configuration failure. */
export async function resolveConfigWithFallback<T>(
  load: () => Promise<T>,
  fallbackValue: T,
): Promise<ConfigResolution<T>> {
  try {
    return { kind: "configured", value: await load() };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { kind: "fallback", value: fallbackValue, error };
  }
}
