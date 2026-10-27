import type { SessionRef } from "@lorelum/backend/client";
import type { ListService, StorageRoot } from "@lorelum/engine";
import { resolveInvocationStorageRoot } from "../../store/storage-root.js";
import { DEFAULT_MAX_CHARACTERS, renderInstalledPackCatalog } from "../pack-catalog.js";
import type { AutoUpdatePoller, CatalogReader, ReadHintReader } from "../types.js";

/** Read installed Pack metadata without querying Practices or connecting to the Backend. */
export function createCatalogReader(
  dependencies: {
    readonly list: Pick<ListService, "listPackDetails">;
    readonly storageRoot: StorageRoot;
  },
  storeRoot?: string,
): CatalogReader {
  return {
    async readCatalog(options) {
      const storageRoot = resolveInvocationStorageRoot(storeRoot, dependencies.storageRoot);
      const details = await dependencies.list.listPackDetails({ storageRoot });
      return renderInstalledPackCatalog(details, options);
    },
  };
}

/** Compact recovery shares the Catalog budget; optional hints cannot discard a usable Catalog. */
export async function readCatalogWithReadHints(
  services: CatalogReader & ReadHintReader,
  session: SessionRef,
): Promise<string> {
  let hints: string | undefined;
  try {
    hints = await services.readHintContext(session);
  } catch {
    // Candidate recovery is optional, including when the Backend is unavailable.
  }
  const catalog = await services.readCatalog({
    maxCharacters: DEFAULT_MAX_CHARACTERS - (hints === undefined ? 0 : hints.length + 2),
  });
  return hints === undefined ? catalog : `${catalog}\n\n${hints}`;
}

/** Keep update discovery optional to the successful Catalog path and fail-open. */
export async function readCatalogWithUpdateNotice(
  services: CatalogReader & { readonly autoUpdate: AutoUpdatePoller },
  eligible: boolean,
): Promise<string> {
  const context = await services.readCatalog();
  if (!eligible) return context;
  try {
    const notice = await services.autoUpdate.poll(true);
    return notice ? `${context}\n\n${notice}` : context;
  } catch {
    return context;
  }
}
