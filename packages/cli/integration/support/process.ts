export interface ProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export class ProcessTimeoutError extends Error {
  constructor(
    command: readonly string[],
    timeoutMs: number,
    result: ProcessResult,
    options?: ErrorOptions,
  ) {
    super(
      `Process timed out after ${timeoutMs} ms: ${JSON.stringify(command)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      options,
    );
    this.name = "ProcessTimeoutError";
  }
}

/** Run a child process, preserving output and waiting for termination after a timeout. */
export async function runProcess(
  command: readonly string[],
  timeoutMs = 60_000,
  input?: string,
  options: {
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly cwd?: string;
  } = {},
): Promise<ProcessResult> {
  const child = Bun.spawn({
    cmd: [...command],
    ...(options.environment === undefined ? {} : { env: options.environment }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stdin: input === undefined ? "ignore" : "pipe",
    stderr: "pipe",
    stdout: "pipe",
  });
  if (input !== undefined) {
    // The spawn options pipe stdin exactly when input is supplied.
    child.stdin!.write(input);
    child.stdin!.end();
  }
  const completed = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stderr, stdout }));

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let terminationError: unknown;
  const timedOut = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      try {
        child.kill();
      } catch (error) {
        terminationError = error;
      }
      resolve();
    }, timeoutMs);
  });

  const outcome = await Promise.race([
    completed.then((result) => ({ kind: "completed" as const, result })),
    timedOut.then(() => ({ kind: "timed-out" as const })),
  ]);
  if (outcome.kind === "completed") {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return outcome.result;
  }

  const result = await completed;
  throw new ProcessTimeoutError(command, timeoutMs, result, {
    cause: terminationError,
  });
}
