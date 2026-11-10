#!/usr/bin/env node
/**
* Batería de evaluación spec §11 contra un despliegue vivo (LLM activo).
* Uso: BASE_URL=https://jpecina.duckdns.org/josemaria-rag node tests/grounding/run-grounding-battery.mjs
*
* Ritmo: Groq (tier on_demand) limita gpt-oss-120b a 8.000 TPM y cada
* pregunta consume ~7.450 tokens de prompt, así que se espera PACE_MS
* (60 s por defecto) entre llamadas. Si un turno vuelve en modo
* extractivo_conservador (firma típica de un 429), se reintenta una vez
* tras 65 s y se registran ambos intentos.
*
* Salida: tests/grounding/results-<fecha>.json con respuestas completas y
* veredictos automáticos por caso (PASS / FAIL / REVISAR).
*/
import { readFile, writeFile} from 'node:fs/promises';

const BASE = (process.env.BASE_URL?? 'https://jpecina.duckdns.org/josemaria-rag').replace(/\/$/, '');
const PACE_MS = Number(process.env.PACE_MS?? 60000);
const ABSTENTION = 'No he encontrado información suficiente sobre esa cuestión en el libro.';
// Ojo: en la primera versión de este fichero los corchetes CJK de esta línea
// se perdieron al guardarlo y quedó una cadena vacía en el array, lo que
// hacía que TODA respuesta «contuviera» el marcador ('' es subcadena de
// cualquier texto). Verificado el 10-nov: el array debe contener los
// caracteres 【 】 † reales; si algún día vuelven a desaparecer, los
// veredictos de marcador dejan de ser fiables y hay que re-evaluar.
const RAW_MARKERS = ['chunk_', String.fromCharCode(0x3010), String.fromCharCode(0x3011), String.fromCharCode(0x2020)]; // 【 】 † por código: los literales se perdían al guardar el fichero
// CASE_FILTER=F01,F02 limita la corrida a esos casos (la primera corrida
// completa murio a los 22 casos por una limpieza de procesos del entorno;
// la bateria se ejecuta por bloques y con guardado parcial tras cada caso).
const CASE_FILTER = process.env.CASE_FILTER? new Set(process.env.CASE_FILTER.split(',')): null;
const { cases: allCases} = JSON.parse(await readFile(new URL('./questions.json', import.meta.url), 'utf8'));
const cases = CASE_FILTER? allCases.filter((c) => CASE_FILTER.has(c.id)): allCases;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCallAt = 0;

async function chat(message, sessionId) {
const wait = PACE_MS - (Date.now() - lastCallAt);
if (lastCallAt && wait > 0) await sleep(wait);
const t0 = Date.now();
try {
const res = await fetch(`${BASE}/api/chat`, {
method: 'POST',
headers: { 'content-type': 'application/json'},
body: JSON.stringify({ message,...(sessionId? { sessionId}: {})}),
signal: AbortSignal.timeout(240000),
});
const data = await res.json().catch(() => ({}));
lastCallAt = Date.now();
return { httpStatus: res.status, ms: Date.now() - t0,...data};
} catch (err) {
lastCallAt = Date.now();
return { httpStatus: 0, ms: Date.now() - t0, error: String(err).slice(0, 300)};
}
}

function norm(s) {
return (s?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function checkTurn(c, turn) {
const e = c.expect?? {};
const problems = [];
const ans = turn.answer?? '';
const citations = turn.citations?? [];
const citedPages = citations.flatMap((x) => x.printedPages?? []);
const citedChapters = citations.map((x) => x.chapter?? '');
for (const m of RAW_MARKERS) if (ans.includes(m)) problems.push(`marcador crudo en la respuesta: ${m}`);
if (e.abstain && ans.trim()!== ABSTENTION) problems.push(`debía abstenerse y no lo hizo (intent=${turn.intent}, mode=${turn.mode})`);
if (!e.abstain && ans.trim() === ABSTENTION) problems.push('se abstuvo pese a la expectativa de respuesta');
if (e.chapter &&!citedChapters.some((ch) => ch.startsWith(e.chapter))) {
problems.push(`sin citas del ${e.chapter} (capítulos citados: ${[...new Set(citedChapters)].join('; ') || 'ninguno'})`);
}
if (e.pagesAny &&!e.pagesAny.some((p) => citedPages.includes(p))) {
problems.push(`sin citas en páginas ${e.pagesAny} (citadas: ${citedPages.join(', ') || 'ninguna'})`);
}
if (e.keyTermsAny &&!e.keyTermsAny.some((t) => norm(ans).includes(norm(t)))) {
problems.push(`la respuesta no contiene ninguno de los términos clave: ${e.keyTermsAny.join(' / ')}`);
}
if (e.intent && turn.intent!== e.intent) problems.push(`intent=${turn.intent}, esperado ${e.intent}`);
if (e.minCitations && citations.length < e.minCitations) problems.push(`citas=${citations.length} < ${e.minCitations}`);
if (e.noCitations && citations.length > 0) problems.push('no debía citar fragmentos');
if (e.respondWithCitations && citations.length === 0) problems.push('debía responder con citas y no citó');
if (e.forbiddenTerms) {
for (const t of e.forbiddenTerms) if (ans.includes(t)) problems.push(`la respuesta contiene el término prohibido: ${t}`);
}
return problems;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = new URL(`./results-${stamp}.json`, import.meta.url);
const results = [];
async function savePartial() {
  await writeFile(outPath, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), results }, null, 1));
}
console.log(`Resultados (guardado tras cada caso): ${outPath.pathname}`);
for (const c of cases) {
const turns = c.turns?? [c.question];
let sessionId;
const turnResults = [];
for (let i = 0; i < turns.length; i++) {
const isLast = i === turns.length - 1;
let attempt = await chat(turns[i], sessionId);
const attempts = [{ mode: attempt.mode, intent: attempt.intent, httpStatus: attempt.httpStatus}];
// Reintento único ante la firma de un 429 (extractivo en categorías que esperan redacción).
if (
attempt.mode === 'extractivo_conservador' &&
['factual', 'resumen', 'ambigua', 'seguimiento'].includes(c.category)
) {
await sleep(65000);
const retry = await chat(turns[i], sessionId);
attempts.push({ mode: retry.mode, intent: retry.intent, httpStatus: retry.httpStatus, retried: true});
if (retry.mode!== 'extractivo_conservador' || isLast) attempt = retry;
}
sessionId = attempt.sessionId?? sessionId;
turnResults.push({
question: turns[i],
ms: attempt.ms,
httpStatus: attempt.httpStatus,
error: attempt.error,
intent: attempt.intent,
mode: attempt.mode,
answer: attempt.answer,
citations: attempt.citations,
evidenceIds: (attempt.evidence?? []).map((x) => x.chunkId),
attempts,
});
console.log(`·· ${c.id} turno ${i + 1}/${turns.length}: intent=${attempt.intent} mode=${attempt.mode} (${attempt.ms} ms)`);
}
const last = turnResults[turnResults.length - 1];
const problems = checkTurn(c, last);
const verdict = problems.length === 0? 'PASS': c.category === 'ambigua'? 'REVISAR': 'FAIL';
results.push({ id: c.id, category: c.category, note: c.note, verdict, problems, turns: turnResults});
console.log(`${verdict} ${c.id} [${c.category}]${problems.length? ':: ' + problems.join(' | '): ''}`);
await savePartial();
}

await savePartial();
const byCat = {};
for (const r of results) {
byCat[r.category]??= { total: 0, pass: 0, fail: 0, revisar: 0};
byCat[r.category].total++;
if (r.verdict === 'PASS') byCat[r.category].pass++;
else if (r.verdict === 'FAIL') byCat[r.category].fail++;
else byCat[r.category].revisar++;
}
console.log('\n=== RESUMEN POR CATEGORÍA ===');
for (const [cat, s] of Object.entries(byCat)) console.log(`${cat}: ${s.pass}/${s.total} PASS, ${s.fail} FAIL, ${s.revisar} REVISAR`);
console.log(`Resultados completos en ${outPath.pathname}`);
