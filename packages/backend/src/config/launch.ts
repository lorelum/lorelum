import { isAbsolute } from "node:path";
import { z } from "zod";
import { BackendError } from "../protocol/errors";
import type { Environment } from "./model";

const launchKeys = [
  "LORELUM_BACKEND_DIRECTORY",
  "LORELUM_BACKEND_INSTANCE",
  "LORELUM_BACKEND_PORT",
] as const;
const launchSchema = z.strictObject({
  runtimeDirectory: z.string().min(1).refine(isAbsolute),
  instanceId: z.string().regex(/^[a-f0-9-]{36}$/),
  port: z.number().int().min(1).max(65_535),
});
export type DaemonLaunch = z.infer<typeof launchSchema>;

/** Recognizes the private launch channel, not user settings. Actual values are validated below. */
export function hasDaemonLaunchEnvironment(environment: Environment = process.env): boolean {
  return launchKeys.every((key) => !!environment[key]);
}

export function consumeDaemonLaunch(environment: NodeJS.ProcessEnv = process.env): DaemonLaunch {
  const port = environment.LORELUM_BACKEND_PORT;
  const result = launchSchema.safeParse({
    runtimeDirectory: environment.LORELUM_BACKEND_DIRECTORY,
    instanceId: environment.LORELUM_BACKEND_INSTANCE,
    port: port !== undefined && /^[0-9]+$/.test(port) ? Number(port) : undefined,
  });
  if (!result.success) throw new BackendError("backend.unauthorized");
  for (const key of launchKeys) delete environment[key];
  return Object.freeze(result.data);
}

/** Select only platform values required by child processes; never retain unrelated credentials. */
export function platformEnvironment(environment: Environment = process.env): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {};
  for (const key of [
    "HOME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
  ]) {
    if (environment[key] !== undefined) selected[key] = environment[key];
  }
  return selected;
}

export function daemonEnvironment(
  launch: DaemonLaunch,
  environment: Environment = process.env,
): NodeJS.ProcessEnv {
  return {
    ...platformEnvironment(environment),
    LORELUM_BACKEND_DIRECTORY: launch.runtimeDirectory,
    LORELUM_BACKEND_INSTANCE: launch.instanceId,
    LORELUM_BACKEND_PORT: String(launch.port),
  };
}
