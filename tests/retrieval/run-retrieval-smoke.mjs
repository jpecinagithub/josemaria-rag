#!/usr/bin/env node
/**
 * Smoke de recuperación contra un despliegue vivo de josemaria-rag.
 * Uso: BASE_URL=https://jpecina.duckdns.org/josemaria-rag node tests/retrieval/run-retrieval-smoke.mjs
 *      BASE_URL=http://127.0.0.1:8100 node tests/retrieval/run-retrieval-smoke.mjs
 * Sale con código 1 si algún caso falla.
 */
import { readFile } from 'node:fs/promises';

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:8100').replace(/\/$/, '');
const { cases } = JSON.parse(await readFile(new URL('./questions.json', import.meta.url), 'utf8'));

const ABSTENTION = 'No he encontrado información suficiente sobre esa cuestión en el libro.';
let failures = 0;

for (const c of cases) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: c.question }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(`FAIL ${c.id}: HTTP ${res.status}`);
    failures++;
    continue;
  }
  const data = await res.json();
  const problems = [];
  const e = c.expect ?? {};
  const citedPages = (data.citations ?? []).flatMap((x) => x.printedPages ?? []);
  const citedChapters = (data.citations ?? []).map((x) => x.chapter ?? '');
  if (e.mustAbstain && data.answer.trim() !== ABSTENTION) problems.push(`debía abstenerse (intent=${data.intent}, mode=${data.mode})`);
  if (e.mustNotAbstain && data.answer.trim() === ABSTENTION) problems.push('se abstuvo pero hay evidencia en el libro');
  if (e.mustCitePrintedPagesAny && !e.mustCitePrintedPagesAny.some((p) => citedPages.includes(p))) {
    problems.push(`ninguna cita en páginas impresas ${e.mustCitePrintedPagesAny} (citas: ${JSON.stringify(data.citations?.map((x) => x.printedPages))})`);
  }
  if (e.mustCiteChapter && !citedChapters.some((ch) => ch.startsWith(e.mustCiteChapter))) {
    problems.push(`ninguna cita del ${e.mustCiteChapter} (capítulos: ${JSON.stringify(citedChapters)})`);
  }
  if (e.minEvidence && (data.evidence ?? []).length < e.minEvidence) {
    problems.push(`evidencia insuficiente: ${(data.evidence ?? []).length} < ${e.minEvidence}`);
  }
  if (e.noCitations && (data.citations ?? []).length > 0) problems.push('no debía citar fragmentos');
  if (e.intent && data.intent !== e.intent) problems.push(`intent=${data.intent}, esperado ${e.intent}`);
  if (problems.length) {
    failures++;
    console.log(`FAIL ${c.id} (${ms} ms): ${problems.join(' | ')}`);
  } else {
    console.log(`PASS ${c.id} (${ms} ms) intent=${data.intent} mode=${data.mode} citas=${(data.citations ?? []).length}`);
  }
}

console.log(failures ? `\n${failures} caso(s) fallidos` : '\nTodos los casos pasan');
process.exit(failures ? 1 : 0);
