/**
 * Shared projection types for retrieval features.
 *
 * The retrieval layer is the neutral home for shape reuse; feature modules do
 * not import one another just to share a result type.
 */

/** One source claim projected for consumers; deliberately decoupled from LocalStore's `PracticeSource` storage model. */
export interface PracticeSourceResult {
  readonly pack: string;
  readonly sourcePath: string;
}
