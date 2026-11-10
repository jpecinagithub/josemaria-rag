-- Esquema inicial del proyecto josemaria-rag (espejo de apps/backend/src/db.ts,
-- que lo aplica de forma idempotente al arrancar y al ingerir).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    sha256 TEXT,
    total_pdf_pages INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_id TEXT NOT NULL UNIQUE,
    chapter TEXT,
    page_start INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    printed_page_start INTEGER,
    printed_page_end INTEGER,
    content TEXT NOT NULL,
    embedding VECTOR(1024) NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('spanish', content)
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chunks_text_idx ON document_chunks USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS chunks_chapter_idx ON document_chunks(chapter);
-- Sin índice HNSW en v1.0: búsqueda vectorial exacta (spec §4).

CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    citations JSONB,
    intent TEXT,
    mode TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_session_idx ON chat_messages(session_id, id);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id BIGSERIAL PRIMARY KEY,
    document_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    detail JSONB,
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);
