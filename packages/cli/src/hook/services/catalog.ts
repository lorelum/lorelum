import type { ListService, StorageRoot } from "@lorelum/engine";
import { resolveInvocationStorageRoot } from "../../store/storage-root.js";
import { renderInstalledPackCatalog } from "../pack-catalog.js";
import type { CatalogReader } from "../types.js";

/** Read installed Pack metadata without querying Practices or connecting to the Backend. */
export function createCatalogReader(
  dependencies: {
    readonly list: Pick<ListService, "listPackDetails">;
    readonly storageRoot: StorageRoot;
  },
  storeRoot?: string,
): CatalogReader {
  return {
    async readCatalog() {
      const storageRoot = resolveInvocationStorageRoot(storeRoot, dependencies.storageRoot);
      const details = await dependencies.list.listPackDetails({ storageRoot });
      return renderInstalledPackCatalog(details);
    },
  };
}
