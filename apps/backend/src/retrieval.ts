import { pool } from './db.js';
import { embedQuery, vectorLiteral } from './embeddings.js';

export interface RetrievedChunk {
  chunkId: string;
  chapter: string | null;
  pageStart: number;
  pageEnd: number;
  printedPageStart: number | null;
  printedPageEnd: number | null;
  content: string;
  vectorScore?: number;
  ftsRank?: number;
  rrfScore: number;
}

const RRF_K = 60;

function rowToChunk(r: any, extra: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    chunkId: r.chunk_id,
    chapter: r.chapter,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    printedPageStart: r.printed_page_start,
    printedPageEnd: r.printed_page_end,
    content: r.content,
    rrfScore: 0,
    ...extra,
  };
}

/**
 * Construye una tsquery con semántica OR a partir de los lexemas de la pregunta.
 *
 * Diagnóstico (10-nov-2026): plainto_tsquery une los lexemas con AND y exige
 * que el fragmento los contenga TODOS; para preguntas naturales en español no
 * lo cumple casi ningún fragmento (la pregunta de las huellas, con 7 lexemas,
 * devolvía 0 filas: la vía FTS estaba muerta y la «híbrida» era solo vectorial).
 * Con OR, ts_rank ordena por cobertura de términos: el fragmento preciso de
 * las huellas (Cap. 5, pp. 123-124) pasa a ser el n.º 1 FTS de la pregunta
 * simple y el n.º 5 de la compuesta.
 */
async function buildOrTsQuery(query: string): Promise<string | null> {
  const res = await pool.query(`SELECT plainto_tsquery('spanish', $1)::text AS t`, [query]);
  const raw = (res.rows[0]?.t as string | undefined)?.trim();
  if (!raw) return null;
  const terms = raw
    .split(' & ')
    .map((s) => s.trim().replace(/^'|'$/g, '').replace(/'/g, "''"))
    .filter(Boolean);
  if (!terms.length) return null;
  return terms.map((t) => `'${t}'`).join(' | ');
}

/** Búsqueda híbrida: pgvector (coseno, exacta) + FTS español (OR), fusionadas con RRF (k=60). */
export async function hybridSearch(
  query: string,
  opts: { candidatesPerPath?: number; finalLimit?: number; guaranteedPerPath?: number } = {},
): Promise<{ chunks: RetrievedChunk[]; bestVectorScore: number; bestFtsRank: number }> {
  const perPath = opts.candidatesPerPath ?? 20;
  const finalLimit = opts.finalLimit ?? 8;
  const guaranteedPerPath = opts.guaranteedPerPath ?? 3;
  const qv = await embedQuery(query);
  const lit = vectorLiteral(qv);
  const orQuery = await buildOrTsQuery(query);

  const [vecRes, ftsRes] = await Promise.all([
    pool.query(
      `SELECT chunk_id, chapter, page_start, page_end, printed_page_start, printed_page_end, content,
              1 - (embedding <=> $1::vector) AS score
         FROM document_chunks
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [lit, perPath],
    ),
    orQuery
      ? pool.query(
          `SELECT chunk_id, chapter, page_start, page_end, printed_page_start, printed_page_end, content,
                  ts_rank(search_vector, q) AS rank
             FROM document_chunks, to_tsquery('spanish', $1) AS q
            WHERE search_vector @@ q
            ORDER BY rank DESC
            LIMIT $2`,
          [orQuery, perPath],
        )
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  const merged = new Map<string, RetrievedChunk>();
  vecRes.rows.forEach((r, i) => {
    const c = rowToChunk(r, { vectorScore: Number(r.score) });
    c.rrfScore += 1 / (RRF_K + i + 1);
    merged.set(c.chunkId, c);
  });
  ftsRes.rows.forEach((r, i) => {
    const existing = merged.get(r.chunk_id);
    if (existing) {
      existing.ftsRank = Number(r.rank);
      existing.rrfScore += 1 / (RRF_K + i + 1);
    } else {
      const c = rowToChunk(r, { ftsRank: Number(r.rank) });
      c.rrfScore = 1 / (RRF_K + i + 1);
      merged.set(c.chunkId, c);
    }
  });

  // Inclusión garantizada: los mejores hits de CADA vía entran siempre en el
  // contexto final. Sin esto, el corte a 8 dejaba fuera al fragmento preciso
  // de las huellas en la pregunta compuesta (n.º 10 vectorial, n.º 5 FTS-OR):
  // los fragmentos genéricos de la Introducción ganan el RRF por acumulación.
  const byRrf = [...merged.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  const guaranteedIds = new Set<string>([
    ...vecRes.rows.slice(0, guaranteedPerPath).map((r) => r.chunk_id as string),
    ...ftsRes.rows.slice(0, guaranteedPerPath).map((r) => r.chunk_id as string),
  ]);
  const selected: RetrievedChunk[] = [];
  for (const c of byRrf) {
    if (guaranteedIds.has(c.chunkId)) selected.push(c);
  }
  for (const c of byRrf) {
    if (selected.length >= finalLimit) break;
    if (!selected.includes(c)) selected.push(c);
  }
  const chunks = selected.slice(0, finalLimit).sort((a, b) => b.rrfScore - a.rrfScore);
  return {
    chunks,
    bestVectorScore: vecRes.rows.length ? Number(vecRes.rows[0].score) : 0,
    bestFtsRank: ftsRes.rows.length ? Number(ftsRes.rows[0].rank) : 0,
  };
}

/** Muestreo equiespaciado de fragmentos de un capítulo (o de todo el libro) para resúmenes. */
export async function sampleChunks(opts: { chapter?: string; limit?: number } = {}): Promise<RetrievedChunk[]> {
  const limit = opts.limit ?? 8;
  const where = opts.chapter ? `WHERE chapter = $1` : '';
  const params = opts.chapter ? [opts.chapter] : [];
  const res = await pool.query(
    `SELECT chunk_id, chapter, page_start, page_end, printed_page_start, printed_page_end, content, chunk_index
       FROM document_chunks ${where} ORDER BY chunk_index`,
    params,
  );
  const rows = res.rows;
  if (rows.length <= limit) return rows.map((r) => rowToChunk(r, {}));
  const picked: RetrievedChunk[] = [];
  const step = rows.length / limit;
  for (let i = 0; i < limit; i++) {
    picked.push(rowToChunk(rows[Math.floor(i * step)], {}));
  }
  return picked;
}

export async function findChapterByName(text: string): Promise<string | null> {
  const res = await pool.query(`SELECT DISTINCT chapter FROM document_chunks WHERE chapter IS NOT NULL`);
  const chapters = res.rows.map((r) => r.chapter as string);
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const t = norm(text);
  const numMatch = t.match(/cap[ií]tulo\s+(\d)/);
  if (numMatch) {
    const found = chapters.find((c) => norm(c).startsWith(`capitulo ${numMatch[1]} `));
    if (found) return found;
  }
  for (const c of chapters) {
    const key = norm(c).split('—')[1]?.trim().split(' ').slice(0, 3).join(' ') ?? '';
    if (key && t.includes(key)) return c;
  }
  if (/ap[eé]ndice/.test(t)) return chapters.find((c) => /Apéndice/.test(c)) ?? null;
  if (/introducci/.test(t)) return chapters.find((c) => c === 'Introducción') ?? null;
  if (/cronolog/.test(t)) return chapters.find((c) => /cronología/i.test(c)) ?? null;
  return null;
}
