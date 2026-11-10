import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createWriteStream } from 'node:fs';
import { rename, copyFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { pool } from './db.js';
import { config, llmConfigured } from './config.js';
import { ollamaReady } from './embeddings.js';
import { handleChat } from './orchestrator.js';
import { runIngestion } from './ingestion/ingest.js';

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.adminToken) {
    reply.code(503).send({ error: 'Administración no configurada: falta ADMIN_TOKEN' });
    return false;
  }
  if (req.headers['x-admin-token'] !== config.adminToken) {
    reply.code(401).send({ error: 'Token de administración no válido' });
    return false;
  }
  return true;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    let dbOk = false;
    let chunks = 0;
    try {
      const r = await pool.query(`SELECT COUNT(*)::int AS n FROM document_chunks`);
      chunks = r.rows[0].n;
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const ollama = await ollamaReady();
    return {
      status: 'ok',
      service: 'josemaria-rag',
      database: dbOk,
      chunks,
      ollama: { ok: ollama.ok, embeddingModel: config.embeddingModel, modelPresent: ollama.models.includes(config.embeddingModel) },
      llm: { configured: llmConfigured(), provider: config.llmBaseUrl.includes('groq') ? 'groq' : 'openai-compatible', model: config.llmModel },
    };
  });

  app.get('/api/book/info', async (_req, reply) => {
    const doc = await pool.query(`SELECT * FROM documents WHERE id = $1`, [config.documentId]);
    if (!doc.rows.length) return reply.code(404).send({ error: 'Libro aún no indexado' });
    const chapters = await pool.query(
      `SELECT chapter, COUNT(*)::int AS chunks, MIN(printed_page_start) AS printed_from, MAX(printed_page_end) AS printed_to
         FROM document_chunks WHERE document_id = $1 GROUP BY chapter ORDER BY MIN(chunk_index)`,
      [config.documentId],
    );
    const job = await pool.query(
      `SELECT status, started_at, finished_at FROM ingestion_jobs WHERE document_id = $1 ORDER BY id DESC LIMIT 1`,
      [config.documentId],
    );
    const d = doc.rows[0];
    return {
      id: d.id,
      title: d.title,
      author: d.author,
      totalPdfPages: d.total_pdf_pages,
      totalChunks: chapters.rows.reduce((a, c) => a + c.chunks, 0),
      chapters: chapters.rows,
      lastIngestion: job.rows[0] ?? null,
    };
  });

  app.post<{ Body: { sessionId?: string; message?: string } }>('/api/chat', async (req, reply) => {
    const message = (req.body?.message ?? '').trim();
    if (!message) return reply.code(400).send({ error: 'Falta el mensaje' });
    if (message.length > 2000) return reply.code(400).send({ error: 'Mensaje demasiado largo (máx. 2000 caracteres)' });
    try {
      const result = await handleChat(req.body?.sessionId, message);
      return result;
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error interno del motor RAG' });
    }
  });

  app.get<{ Params: { sessionId: string } }>('/api/chat/:sessionId', async (req, reply) => {
    const s = await pool.query(`SELECT id, created_at, updated_at FROM chat_sessions WHERE id = $1`, [
      req.params.sessionId,
    ]);
    if (!s.rows.length) return reply.code(404).send({ error: 'Sesión no encontrada' });
    const msgs = await pool.query(
      `SELECT role, content, citations, intent, mode, created_at FROM chat_messages WHERE session_id = $1 ORDER BY id`,
      [req.params.sessionId],
    );
    return { sessionId: req.params.sessionId, createdAt: s.rows[0].created_at, messages: msgs.rows };
  });

  // ---- Administración (protegida por token) ----

  app.post('/api/admin/book', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Falta el fichero PDF (campo file)' });
    if (!/pdf/i.test(part.mimetype) && !part.filename.toLowerCase().endsWith('.pdf')) {
      return reply.code(400).send({ error: 'El fichero debe ser un PDF' });
    }
    const tmp = `${config.pdfPath}.upload`;
    await pipeline(part.file, createWriteStream(tmp));
    await copyFile(config.pdfPath, `${config.pdfPath}.bak`).catch(() => {});
    await rename(tmp, config.pdfPath);
    return { saved: true, filename: part.filename, path: config.pdfPath, note: 'Lanza POST /api/admin/reindex para reconstruir el índice.' };
  });

  app.post('/api/admin/reindex', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    runIngestion()
      .then((r) => req.log.info({ report: r }, 'reindexación completada'))
      .catch((err) => req.log.error(err, 'reindexación fallida'));
    return reply.code(202).send({ started: true, statusEndpoint: '/api/admin/ingestion-status' });
  });

  app.get('/api/admin/ingestion-status', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const job = await pool.query(
      `SELECT id, status, detail, error, started_at, finished_at FROM ingestion_jobs ORDER BY id DESC LIMIT 1`,
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM document_chunks`);
    return { job: job.rows[0] ?? null, chunks: count.rows[0].n };
  });
}
