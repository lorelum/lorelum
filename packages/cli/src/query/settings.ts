import {
  ConfigError,
  loadConfig,
  resolveLorelumPaths,
  configValueType,
  type ConfigDocument,
  type ConfigFailure,
  type ConfigRule,
  type ConfigSource,
  type ConfigReader,
  type LoadConfigOptions,
} from "@lorelum/config";
import {
  DEFAULT_VECTOR_RETRIEVAL_METHOD_ID,
  VECTOR_RETRIEVAL_METHOD_IDS,
  isVectorRetrievalMethodId,
  type VectorRetrievalMethodId,
} from "@lorelum/engine";

import { CliError } from "../runtime/errors";

export interface QuerySettings {
  readonly maxWaitMs: number;
  readonly minCoveragePercent: number;
}

export const DEFAULT_QUERY_SETTINGS: QuerySettings = Object.freeze({
  maxWaitMs: 3_000,
  minCoveragePercent: 0,
});

export interface SemanticRetrievalSettings {
  readonly retrievalMethod: VectorRetrievalMethodId;
}

export const DEFAULT_SEMANTIC_RETRIEVAL_SETTINGS: SemanticRetrievalSettings = Object.freeze({
  retrievalMethod: DEFAULT_VECTOR_RETRIEVAL_METHOD_ID,
});

const maxWaitRule = { kind: "integer", minimum: 0, maximum: 120_000 } as const;
const coverageRule = { kind: "integer", minimum: 0, maximum: 100 } as const;

function fileSource(options: LoadConfigOptions): ConfigSource {
  return {
    kind: "file",
    path: options.filePath ?? resolveLorelumPaths(options.homeDirectory).configFile,
  };
}

function invalid(failure: ConfigFailure | ConfigError): never {
  const error = failure instanceof ConfigError ? failure : new ConfigError(failure);
  throw new CliError("query.config-invalid", error.message, undefined, { cause: error });
}

function invalidSection(value: unknown, source: ConfigSource): never {
  const receivedType = configValueType(value);
  return invalid({
    kind: "setting",
    source,
    subject: "query section",
    reason: "type",
    rule: { kind: "shape", expected: "object" },
    ...(receivedType === undefined ? {} : { receivedType }),
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(
  value: unknown,
  key: string,
  rule: Extract<ConfigRule, { kind: "integer" }>,
  source: ConfigSource,
): number | undefined {
  if (value === undefined) return undefined;
  const receivedType = configValueType(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    invalid({
      kind: "setting",
      source,
      subject: key,
      reason: "type",
      rule,
      ...(receivedType === undefined ? {} : { receivedType }),
    });
  if (value < rule.minimum || value > rule.maximum)
    invalid({
      kind: "setting",
      source,
      subject: key,
      reason: "range",
      rule,
      receivedScalar: value,
    });
  return value;
}

/** Consumer-owned validation: unrelated query fields remain available to their owners. */
export async function loadQuerySettings(
  options: LoadConfigOptions = {},
  readConfig?: ConfigReader,
): Promise<QuerySettings> {
  let document: ConfigDocument;
  try {
    document = await (readConfig === undefined ? loadConfig(options) : readConfig());
  } catch (error) {
    if (error instanceof ConfigError) invalid(error);
    throw error;
  }
  if (document.query === undefined) return DEFAULT_QUERY_SETTINGS;
  const source = fileSource(options);
  if (!isPlainObject(document.query)) invalidSection(document.query, source);
  return Object.freeze({
    maxWaitMs:
      integer(document.query.maxWaitMs, "query.maxWaitMs", maxWaitRule, source) ??
      DEFAULT_QUERY_SETTINGS.maxWaitMs,
    minCoveragePercent:
      integer(
        document.query.minCoveragePercent,
        "query.minCoveragePercent",
        coverageRule,
        source,
      ) ?? DEFAULT_QUERY_SETTINGS.minCoveragePercent,
  });
}

/** Only the semantic consumer validates the method; keyword remains independent. */
export async function loadSemanticRetrievalSettings(
  options: LoadConfigOptions = {},
  readConfig?: ConfigReader,
): Promise<SemanticRetrievalSettings> {
  let document: ConfigDocument;
  try {
    document = await (readConfig === undefined ? loadConfig(options) : readConfig());
  } catch (error) {
    if (error instanceof ConfigError) invalid(error);
    throw error;
  }
  if (document.query === undefined) return DEFAULT_SEMANTIC_RETRIEVAL_SETTINGS;
  const source = fileSource(options);
  if (!isPlainObject(document.query)) invalidSection(document.query, source);
  const retrievalMethod = document.query.retrievalMethod;
  if (retrievalMethod === undefined) return DEFAULT_SEMANTIC_RETRIEVAL_SETTINGS;
  if (!isVectorRetrievalMethodId(retrievalMethod)) {
    const receivedType = configValueType(retrievalMethod);
    invalid({
      kind: "setting",
      source,
      subject: "query.retrievalMethod",
      reason: "enum",
      rule: { kind: "enum", values: VECTOR_RETRIEVAL_METHOD_IDS },
      ...(receivedType === undefined ? {} : { receivedType }),
    });
  }
  return Object.freeze({ retrievalMethod });
}
