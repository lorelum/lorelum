import { PACK_NAME_REGEX, SEMVER_REGEX } from "@lorelum/format";

import { invalidInvocationError } from "../runtime/errors.js";

export interface PackSpecifier {
  readonly packName: string;
  readonly requestedVersion: string | undefined;
}

/** Parse one exact Pack reference: `pack` or `pack@version`. */
export function parsePackSpecifier(value: string): PackSpecifier {
  const separator = value.indexOf("@");
  if (separator === -1) {
    if (!PACK_NAME_REGEX.test(value))
      throw invalidInvocationError("Use a valid Pack name or pack@version.");
    return { packName: value, requestedVersion: undefined };
  }

  if (separator === 0 || separator !== value.lastIndexOf("@"))
    throw invalidInvocationError("Use exactly one @ between the Pack name and version.");
  const packName = value.slice(0, separator);
  const requestedVersion = value.slice(separator + 1);
  if (!PACK_NAME_REGEX.test(packName) || !SEMVER_REGEX.test(requestedVersion)) {
    throw invalidInvocationError("Use a valid Pack name and semantic version (pack@version).");
  }
  return { packName, requestedVersion };
}
