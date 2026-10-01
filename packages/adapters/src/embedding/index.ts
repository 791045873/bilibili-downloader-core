export {
  EmbeddingClient,
  EmbeddingApiError,
  EMBEDDING_BATCH_LIMIT,
  EMBEDDING_TIMEOUT_MS,
  type EmbeddingClientConfig,
} from "./embedding-client.js";
export {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_BASE_URL,
  EmbeddingConfigError,
  normalizeEmbeddingText,
} from "./embedding-defaults.js";
