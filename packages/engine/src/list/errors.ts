/** Thrown when `list --pack` names a Pack absent from the active manifest. */
export class UnknownPackError extends Error {
  constructor(packName: string) {
    super(`No installed Pack exists with name "${packName}".`);
    this.name = "UnknownPackError";
  }
}
