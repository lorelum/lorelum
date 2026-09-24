import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative, join, sep } from "node:path";

export interface ReadHint {
  readonly id: string;
  readonly digest: string;
  readonly title: string;
  readonly appliesWhen?: string;
  readonly packs: readonly string[];
}

export interface ShellToolEvent {
  readonly hostKey: string;
  readonly event: "pre" | "post";
  readonly toolKind: "shell" | "other";
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly cwd: string;
}

interface ActiveWindow {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly cwd: string;
  readonly startedAt: number;
}

const windowLifetimeMs = 30 * 60 * 1000;
const maxLedgerBytes = 256 * 1024;

function fileKey(...parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function inWorkspace(cwd: string, workspace: string): boolean {
  const difference = relative(workspace, cwd);
  return (
    difference === "" ||
    (difference !== ".." && !difference.startsWith(`..${sep}`) && !difference.startsWith(sep))
  );
}

function validWindow(value: unknown): value is ActiveWindow {
  if (typeof value !== "object" || value === null) return false;
  const window = value as Record<string, unknown>;
  return (
    typeof window.hostKey === "string" &&
    typeof window.sessionId === "string" &&
    typeof window.toolUseId === "string" &&
    typeof window.cwd === "string" &&
    typeof window.startedAt === "number"
  );
}

function validHint(value: unknown): value is ReadHint {
  if (typeof value !== "object" || value === null) return false;
  const hint = value as Record<string, unknown>;
  return (
    typeof hint.id === "string" &&
    typeof hint.digest === "string" &&
    typeof hint.title === "string" &&
    (hint.appliesWhen === undefined || typeof hint.appliesWhen === "string") &&
    Array.isArray(hint.packs) &&
    hint.packs.every((pack: unknown) => typeof pack === "string")
  );
}

export class PracticeHintLedger {
  constructor(
    private readonly root = join(
      tmpdir(),
      `lorelum-practice-hints-${process.getuid?.() ?? "user"}`,
    ),
    private readonly now: () => number = Date.now,
  ) {}

  private async ensurePrivateRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      const details = await stat(this.root);
      if (details.uid !== process.getuid?.() || (details.mode & 0o077) !== 0) {
        throw new Error("The Practice hint runtime directory is not private to this user.");
      }
    }
  }

  private windowFile(hostKey: string, toolUseId: string): string {
    return join(this.root, "windows", `${fileKey(hostKey, toolUseId)}.json`);
  }

  private sessionFile(hostKey: string, sessionId: string): string {
    return join(this.root, "sessions", `${fileKey(hostKey, sessionId)}.jsonl`);
  }

  /** Host-neutral routing: only shell tools establish or close a window. */
  async routeToolEvent(event: ShellToolEvent): Promise<void> {
    if (event.toolKind !== "shell") return;
    if (event.event === "post") {
      try {
        await unlink(this.windowFile(event.hostKey, event.toolUseId));
      } catch {
        /* optional hint */
      }
      return;
    }
    await this.ensurePrivateRoot();
    const directory = join(this.root, "windows");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const window: ActiveWindow = {
      hostKey: event.hostKey,
      sessionId: event.sessionId,
      toolUseId: event.toolUseId,
      cwd: resolve(event.cwd),
      startedAt: this.now(),
    };
    await writeFile(this.windowFile(event.hostKey, event.toolUseId), JSON.stringify(window), {
      mode: 0o600,
    });
  }

  /** Called by the CLI's successful get path; never parses host commands or output. */
  async recordSuccessfulGet(cwd: string, hint: ReadHint): Promise<void> {
    try {
      const details = await stat(this.root);
      if (
        process.platform !== "win32" &&
        (details.uid !== process.getuid?.() || (details.mode & 0o077) !== 0)
      )
        return;
    } catch {
      return;
    }
    const windows = await this.activeWindows(resolve(cwd));
    const window = windows[0];
    if (window === undefined) return;
    const directory = join(this.root, "sessions");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = this.sessionFile(window.hostKey, window.sessionId);
    try {
      if ((await stat(file)).size >= maxLedgerBytes) return;
    } catch {
      /* first entry */
    }
    await appendFile(file, `${JSON.stringify(hint)}\n`, { mode: 0o600 });
  }

  async readRecentHints(hostKey: string, sessionId: string): Promise<ReadHint[]> {
    try {
      const details = await stat(this.root);
      if (
        process.platform !== "win32" &&
        (details.uid !== process.getuid?.() || (details.mode & 0o077) !== 0)
      )
        return [];
    } catch {
      return [];
    }
    let content: string;
    try {
      content = await readFile(this.sessionFile(hostKey, sessionId), "utf8");
    } catch {
      return [];
    }
    const seen = new Set<string>();
    const hints: ReadHint[] = [];
    for (const line of content.split("\n").reverse()) {
      try {
        const hint: unknown = JSON.parse(line);
        if (!validHint(hint) || seen.has(hint.id)) continue;
        seen.add(hint.id);
        hints.push(hint);
      } catch {
        /* incomplete append or blank line */
      }
    }
    return hints;
  }

  private async activeWindows(cwd: string): Promise<ActiveWindow[]> {
    let names: string[];
    try {
      names = await readdir(join(this.root, "windows"));
    } catch {
      return [];
    }
    const windows = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            const window: unknown = JSON.parse(
              await readFile(join(this.root, "windows", name), "utf8"),
            );
            return validWindow(window) &&
              this.now() - window.startedAt >= 0 &&
              this.now() - window.startedAt < windowLifetimeMs &&
              inWorkspace(cwd, window.cwd)
              ? window
              : undefined;
          } catch {
            return undefined;
          }
        }),
    );
    return windows
      .filter((window): window is ActiveWindow => window !== undefined)
      .sort(
        (a, b) =>
          b.cwd.length - a.cwd.length ||
          b.startedAt - a.startedAt ||
          a.toolUseId.localeCompare(b.toolUseId),
      );
  }
}

export const defaultPracticeHintLedger = new PracticeHintLedger();
