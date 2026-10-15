import {
  createListService,
  defaultStorageRoot,
  type ListPackDetailsResult,
  type ListService,
  type StorageRoot,
} from "@lorelum/engine";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";

export interface CatalogServices {
  readonly list: Pick<ListService, "listPackDetails">;
  readonly storageRoot: StorageRoot;
}

export const defaultCatalogServices: CatalogServices = Object.freeze({
  list: createListService(),
  storageRoot: defaultStorageRoot(),
});

/** Read installed Pack metadata without querying Practices or starting the Backend. */
export function readInstalledPackDetails(
  services: CatalogServices = defaultCatalogServices,
  storeRoot?: string,
): Promise<ListPackDetailsResult> {
  const storageRoot = resolveInvocationStorageRoot(storeRoot, services.storageRoot);
  return services.list.listPackDetails({ storageRoot });
}
