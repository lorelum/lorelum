import type {
  ListPackDetailsResult,
  ListPackPracticesResult,
  ListPacksResult,
} from "@lorelum/engine";

import { renderStructuredText } from "../output/structured-text.js";

export function renderPackListText(result: ListPacksResult): string {
  return renderStructuredText({
    packs: result.packs.map(({ name, version }) => ({ name, version })),
  });
}

export function renderPackDetailsText(result: ListPackDetailsResult): string {
  return renderStructuredText({
    packs: result.packs.map(({ name, version, description, applies_to }) => ({
      name,
      version,
      ...(description === undefined ? {} : { description }),
      ...(applies_to === undefined || applies_to.length === 0 ? {} : { appliesTo: applies_to }),
    })),
  });
}

export function renderPackPracticesText(result: ListPackPracticesResult): string {
  return renderStructuredText({
    pack: { name: result.pack.name, packRoot: result.pack.packRoot },
    practices: result.practices.map(({ id, title, applies_when }) => ({
      id,
      title,
      applies_when,
    })),
  });
}
