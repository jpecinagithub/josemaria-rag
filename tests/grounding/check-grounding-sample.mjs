// Verificación de fundamentación sobre la muestra: para los casos en modo
// agente con citas, comprueba contra la BD que (1) cada chunk citado existe,
// (2) capítulo y páginas impresas de la cita coinciden con la BD y
// (3) los términos clave del caso aparecen en el TEXTO de los fragmentos
// citados (no solo en la respuesta redactada).
// Se ejecuta DENTRO del contenedor backend (tiene pg y DATABASE_URL):
//   docker cp results-fusion.json josemaria-rag-backend-1:/app/results.json
//   docker cp check-grounding-sample.mjs josemaria-rag-backend-1:/app/
//   docker exec -w /app josemaria-rag-backend-1 node check-grounding-sample.mjs /app/results.json 15
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const file = process.argv[2] ?? '/app/results.json';
const sampleSize = Number(process.argv[3] ?? 15);
const data = JSON.parse(await readFile(file, 'utf8'));
const { cases } = JSON.parse(await readFile('/app/questions.json', 'utf8').catch(() => readFile(new URL('./questions.json', import.meta.url), 'utf8')));
const expectById = new Map(cases.map((c) => [c.id, c.expect ?? {}]));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const norm = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const candidates = data.results.filter((r) => {
  const last = r.turns[r.turns.length - 1];
  return last.mode === 'agente' && (last.citations ?? []).length > 0;
});
const sample = candidates.slice(0, sampleSize);
console.log(`casos agente con citas: ${candidates.length}; muestra: ${sample.length}`);
let ok = 0;
for (const r of sample) {
  const last = r.turns[r.turns.length - 1];
  const exp = expectById.get(r.id) ?? {};
  const ids = [...new Set((last.citations ?? []).map((c) => c.chunkId))];
  const db = await pool.query(
    `SELECT chunk_id, chapter, printed_page_start, printed_page_end, content FROM document_chunks WHERE chunk_id = ANY($1)`, [ids]);
  const byId = new Map(db.rows.map((x) => [x.chunk_id, x]));
  const problems = [];
  for (const cit of last.citations ?? []) {
    const row = byId.get(cit.chunkId);
    if (!row) { problems.push(`${cit.chunkId} no existe en BD`); continue; }
    if (row.chapter !== cit.chapter) problems.push(`${cit.chunkId}: capítulo cita=${cit.chapter} BD=${row.chapter}`);
    if (row.printed_page_start !== cit.printedPages?.[0] || row.printed_page_end !== cit.printedPages?.[1]) {
      problems.push(`${cit.chunkId}: páginas cita=${cit.printedPages} BD=${row.printed_page_start}-${row.printed_page_end}`);
    }
  }
  let termCheck = 'sin términos definidos';
  if (exp.keyTermsAny?.length) {
    const citedText = norm(ids.map((id) => byId.get(id)?.content ?? '').join(' '));
    const found = exp.keyTermsAny.filter((t) => citedText.includes(norm(t)));
    termCheck = found.length ? `términos en fragmentos citados: ${found.join(' / ')}` : 'NINGÚN término clave en los fragmentos citados';
    if (!found.length) problems.push('los fragmentos citados no contienen los términos clave del hecho');
  }
  const verdict = problems.length ? 'FALLO' : 'OK';
  if (!problems.length) ok++;
  console.log(`${verdict} ${r.id}: citas=${ids.join(',')} :: ${termCheck}${problems.length ? ' :: ' + problems.join(' | ') : ''}`);
}
console.log(`muestra: ${ok}/${sample.length} citas íntegras y respaldadas`);
await pool.end();
