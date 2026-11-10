import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pool, initSchema } from '../db.js';
import { config } from '../config.js';
import { embedTexts, vectorLiteral } from '../embeddings.js';
import { extractPdf, computeOffset, detectChapter, type ExtractedPage } from './pdf.js';
import { chunkSegments, type PageSegment } from './chunk.js';

export const INGEST_FROM = Number(process.env.INGEST_FROM ?? 10);
export const INGEST_TO = Number(process.env.INGEST_TO ?? 315);
export const BOOK_TITLE = 'Josemaría Escrivá en Logroño (1915-1925)';
export const BOOK_AUTHOR = 'Jaime Toldrá Parés';

export interface IngestionReport {
  documentId: string;
  title: string;
  sha256: string;
  totalPdfPages: number;
  ingestRange: { from: number; to: number };
  printedOffset: number;
  offsetVotes: number;
  pagesIngested: number;
  pagesWithoutText: number[];
  totalChunks: number;
  embeddingModel: string;
  embeddingDims: number;
  avgTokensPerChunk: number;
  perChapter: Record<
    string,
    { chunks: number; pdfPages: [number, number]; printedPages: [number, number] }
  >;
  durationMs: number;
}

export async function runIngestion(pdfPath: string = config.pdfPath): Promise<IngestionReport> {
  const started = Date.now();
  await initSchema();
  const job = await pool.query(
    `INSERT INTO ingestion_jobs (document_id, status) VALUES ($1, 'running') RETURNING id`,
    [config.documentId],
  );
  const jobId = job.rows[0].id as number;
  try {
    const buf = await readFile(pdfPath);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const { totalPages, pages } = await extractPdf(pdfPath);
    const { offset, votes } = computeOffset(pages);

    const inRange = pages.filter((p) => p.pdfPage >= INGEST_FROM && p.pdfPage <= INGEST_TO);
    const pagesWithoutText = inRange.filter((p) => p.text.trim().length < 40).map((p) => p.pdfPage);

    let currentChapter = 'Preliminares';
    const segments: PageSegment[] = [];
    for (const p of inRange) {
      const detected = detectChapter(p.rawHead);
      if (detected) currentChapter = detected;
      if (!p.text.trim()) continue;
      segments.push({
        pdfPage: p.pdfPage,
        printedPage: p.printedCandidate ?? p.pdfPage + offset,
        chapter: currentChapter,
        text: p.text,
      });
    }

    const chunks = chunkSegments(segments);

    await pool.query(
      `INSERT INTO documents (id, title, author, sha256, total_pdf_pages)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, author=EXCLUDED.author,
         sha256=EXCLUDED.sha256, total_pdf_pages=EXCLUDED.total_pdf_pages`,
      [config.documentId, BOOK_TITLE, BOOK_AUTHOR, sha256, totalPages],
    );
    await pool.query(`DELETE FROM document_chunks WHERE document_id = $1`, [config.documentId]);

    const BATCH = 16;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeddings = await embedTexts(batch.map((c) => c.content));
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        await pool.query(
          `INSERT INTO document_chunks
             (document_id, chunk_index, chunk_id, chapter, page_start, page_end,
              printed_page_start, printed_page_end, content, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector)`,
          [
            config.documentId,
            c.chunkIndex,
            c.chunkId,
            c.chapter,
            c.pageStart,
            c.pageEnd,
            c.printedPageStart,
            c.printedPageEnd,
            c.content,
            vectorLiteral(embeddings[j]),
          ],
        );
      }
      console.log(`ingestión: ${Math.min(i + BATCH, chunks.length)}/${chunks.length} fragmentos`);
    }

    const perChapter: IngestionReport['perChapter'] = {};
    for (const c of chunks) {
      const e = (perChapter[c.chapter] ??= {
        chunks: 0,
        pdfPages: [c.pageStart, c.pageEnd],
        printedPages: [c.printedPageStart, c.printedPageEnd],
      });
      e.chunks += 1;
      e.pdfPages = [Math.min(e.pdfPages[0], c.pageStart), Math.max(e.pdfPages[1], c.pageEnd)];
      e.printedPages = [
        Math.min(e.printedPages[0], c.printedPageStart),
        Math.max(e.printedPages[1], c.printedPageEnd),
      ];
    }

    const report: IngestionReport = {
      documentId: config.documentId,
      title: BOOK_TITLE,
      sha256,
      totalPdfPages: totalPages,
      ingestRange: { from: INGEST_FROM, to: INGEST_TO },
      printedOffset: offset,
      offsetVotes: votes,
      pagesIngested: segments.length,
      pagesWithoutText,
      totalChunks: chunks.length,
      embeddingModel: config.embeddingModel,
      embeddingDims: config.embeddingDims,
      avgTokensPerChunk: Math.round(chunks.reduce((a, c) => a + c.tokensEst, 0) / Math.max(chunks.length, 1)),
      perChapter,
      durationMs: Date.now() - started,
    };
    await writeFile(`${config.dataDir}/ingestion-report.json`, JSON.stringify(report, null, 2)).catch(() => {});
    await pool.query(
      `UPDATE ingestion_jobs SET status='completed', detail=$2, finished_at=NOW() WHERE id=$1`,
      [jobId, JSON.stringify(report)],
    );
    return report;
  } catch (err) {
    await pool.query(
      `UPDATE ingestion_jobs SET status='failed', error=$2, finished_at=NOW() WHERE id=$1`,
      [jobId, err instanceof Error ? err.message : String(err)],
    ).catch(() => {});
    throw err;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runIngestion(process.argv[2])
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      return pool.end();
    })
    .catch(async (err) => {
      console.error('INGESTIÓN FALLIDA:', err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
