#!/usr/bin/env node
/**
* Re-evaluación offline de un results-*.json de la batería.
* Uso: node tests/grounding/reevaluate.mjs tests/grounding/results-<fecha>.json
*
* Motivo: la primera corrida (10-nov) se ejecutó con RAW_MARKERS corrupto
* (una cadena vacía en el array) y marcó «marcador crudo» en los 50 casos.
* Las respuestas quedaron guardadas íntegras en el JSON, así que los
* veredictos se recalculan aquí con la lógica corregida, sin repetir
* llamadas a la API. Escribe results-<fecha>-reevaluado.json.
*/
import { readFile, writeFile} from 'node:fs/promises';

const file = process.argv[2];
if (!file) { console.error('falta la ruta del results-*.json'); process.exit(2);}
const data = JSON.parse(await readFile(file, 'utf8'));
const { cases} = JSON.parse(await readFile(new URL('./questions.json', import.meta.url), 'utf8'));
const byId = new Map(cases.map((c) => [c.id, c]));
const ABSTENTION = 'No he encontrado información suficiente sobre esa cuestión en el libro.';
const RAW_MARKERS = ['chunk_', String.fromCharCode(0x3010), String.fromCharCode(0x3011), String.fromCharCode(0x2020)]; // 【 】 † por código: los literales se perdían al guardar el fichero
const norm = (s) => (s?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

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
if (e.forbiddenTerms) for (const t of e.forbiddenTerms) if (ans.includes(t)) problems.push(`la respuesta contiene el término prohibido: ${t}`);
return problems;
}

for (const r of data.results) {
const c = byId.get(r.id);
const last = r.turns[r.turns.length - 1];
r.problemsOriginales = r.problems;
r.verdictOriginal = r.verdict;
r.problems = checkTurn(c, last);
r.verdict = r.problems.length === 0? 'PASS': r.category === 'ambigua'? 'REVISAR': 'FAIL';
}
const out = file.replace(/\.json$/, '-reevaluado.json');
await writeFile(out, JSON.stringify(data, null, 1));
const byCat = {};
for (const r of data.results) {
byCat[r.category]??= { total: 0, pass: 0, fail: 0, revisar: 0};
byCat[r.category].total++;
if (r.verdict === 'PASS') byCat[r.category].pass++;
else if (r.verdict === 'FAIL') byCat[r.category].fail++;
else byCat[r.category].revisar++;
}
for (const [cat, s] of Object.entries(byCat)) console.log(`${cat}: ${s.pass}/${s.total} PASS, ${s.fail} FAIL, ${s.revisar} REVISAR`);
console.log(`Re-evaluación en ${out}`);
