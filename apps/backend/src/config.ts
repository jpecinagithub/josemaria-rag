export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8100),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://rag:rag@localhost:5432/josemaria_rag',
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
  embeddingModel: process.env.EMBEDDING_MODEL ?? 'qwen3-embedding:0.6b',
  embeddingDims: Number(process.env.EMBEDDING_DIMS ?? 1024),
  llmBaseUrl: (process.env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
  llmApiKey: process.env.GROQ_API_KEY ?? process.env.LLM_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? 'llama-3.3-70b-versatile',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  pdfPath: process.env.PDF_PATH ?? '/app/data/book.pdf',
  dataDir: process.env.DATA_DIR ?? '/app/data',
  staticDir: process.env.STATIC_DIR ?? '/app/public',
  retrievalMinScore: Number(process.env.RETRIEVAL_MIN_SCORE ?? 0.55),
  documentId: process.env.DOCUMENT_ID ?? 'josemaria-rioja',
};

export function llmConfigured(): boolean {
  return config.llmApiKey.trim().length > 0;
}
