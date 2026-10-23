import { normalizeVersion, type Release, type UpdateChannel } from "./version-catalog.js";

const apiUrl = "https://api.github.com/repos/lorelum/lorelum/releases?per_page=100";
const officialNotes = /^https:\/\/github\.com\/lorelum\/lorelum\/releases\/tag\/[^/?#]+$/;

/** An incomplete page is a failed check, never an empty or partial catalog. */
export async function listReleases(
  channel: UpdateChannel,
  target: string,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
  firstPage = apiUrl,
  options: { readonly signal?: AbortSignal } = {},
): Promise<readonly Release[]> {
  const candidates: Release[] = [];
  let next: string | undefined = firstPage;
  const seen = new Set<string>();
  while (next !== undefined) {
    options.signal?.throwIfAborted();
    if (seen.has(next)) throw new Error("release pagination cycle");
    seen.add(next);
    const signal = options.signal ?? AbortSignal.timeout(10_000);
    const response: Response = await awaitWithAbort(
      () =>
        request(next!, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "lorelum-cli" },
          signal,
        }),
      options.signal,
    );
    if (!response.ok) throw new Error("release service unavailable");
    const body: unknown = await awaitWithAbort(() => response.json(), options.signal);
    if (!Array.isArray(body)) throw new Error("invalid release list");
    for (const item of body) {
      if (!validRelease(item)) throw new Error("invalid release metadata");
      if (item.draft) continue;
      const version = normalizeVersion(item.tag_name);
      if (version === undefined) continue;
      const prerelease = version.split("+")[0]!.includes("-");
      if (prerelease !== item.prerelease || (channel === "stable" && prerelease)) continue;
      const archive = `lore-${version}-${target}.${target === "win32-x64" ? "zip" : "tar.gz"}`;
      const assetNames = item.assets.map((asset) => asset.name);
      if (!assetNames.includes(archive) || !assetNames.includes("SHA256SUMS")) continue;
      if (!officialNotes.test(item.html_url)) throw new Error("invalid release notes URL");
      candidates.push({ version, notesUrl: item.html_url });
    }
    const link: string | null = response.headers.get("link");
    const nextPart = link
      ?.split(",")
      .map((part) => part.trim())
      .find((part) => /rel="?next"?/.test(part));
    const match = nextPart?.match(/^<([^>]+)>;\s*rel="next"$/);
    if (nextPart !== undefined && !match) throw new Error("invalid release pagination link");
    next = match?.[1];
    if (next !== undefined && new URL(next).origin !== new URL(firstPage).origin)
      throw new Error("invalid release pagination URL");
  }
  options.signal?.throwIfAborted();
  return candidates;
}

async function awaitWithAbort<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return operation();
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

interface ReleaseMetadata {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly html_url: string;
  readonly assets: readonly { readonly name: string }[];
}

function validRelease(value: unknown): value is ReleaseMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.tag_name === "string" &&
    typeof item.draft === "boolean" &&
    typeof item.prerelease === "boolean" &&
    typeof item.html_url === "string" &&
    Array.isArray(item.assets) &&
    item.assets.every(
      (asset: unknown) =>
        asset !== null &&
        typeof asset === "object" &&
        !Array.isArray(asset) &&
        typeof (asset as Record<string, unknown>).name === "string",
    )
  );
}
