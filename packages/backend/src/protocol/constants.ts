export const BACKEND_HOST = "127.0.0.1";
export const BACKEND_PORT = 26186;
export const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
export const PROTOCOL_VERSION = 1;
export const MAX_BODY_BYTES = 65_536;
export const MAX_RESPONSE_BYTES = 262_144;

const INTERNAL_API_PREFIX = "/internal/v1";
export const BACKEND_ROUTES = {
  identity: `${INTERNAL_API_PREFIX}/identity`,
  status: `${INTERNAL_API_PREFIX}/status`,
  stop: `${INTERNAL_API_PREFIX}/stop`,
  query: `${INTERNAL_API_PREFIX}/query`,
  modelLoad: `${INTERNAL_API_PREFIX}/model/load`,
  modelStatus: `${INTERNAL_API_PREFIX}/model/status`,
  modelUnload: `${INTERNAL_API_PREFIX}/model/unload`,
  embeddings: `${INTERNAL_API_PREFIX}/embeddings`,
  indexStatus: `${INTERNAL_API_PREFIX}/index/status`,
  indexBuild: `${INTERNAL_API_PREFIX}/index/build`,
  indexRebuild: `${INTERNAL_API_PREFIX}/index/rebuild`,
  indexOperation: `${INTERNAL_API_PREFIX}/index/operations/:operationId`,
} as const;
