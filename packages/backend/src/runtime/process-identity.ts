import { platformEnvironment } from "../config/launch";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BackendError } from "../protocol/errors";
const execute = promisify(execFile);
export interface ProcessIdentity {
  readonly pid: number;
  readonly startedAt: string;
}

export async function processIdentity(pid: number): Promise<ProcessIdentity | undefined> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ESRCH")
      return undefined;
    throw new BackendError("backend.state-invalid", { cause: error });
  }
  try {
    const { stdout } = await execute("ps", ["-o", "lstart=", "-p", String(pid)], {
      timeout: 2_000,
      env: { ...platformEnvironment(), LC_ALL: "C" },
    });
    const startedAt = stdout.trim();
    if (!startedAt) throw new BackendError("backend.state-invalid");
    return { pid, startedAt };
  } catch (error) {
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if (probe !== null && typeof probe === "object" && "code" in probe && probe.code === "ESRCH")
        return undefined;
    }
    throw new BackendError("backend.state-invalid", { cause: error });
  }
}
export async function isSameProcess(expected: ProcessIdentity): Promise<boolean> {
  const actual = await processIdentity(expected.pid);
  return actual !== undefined && actual.startedAt === expected.startedAt;
}
