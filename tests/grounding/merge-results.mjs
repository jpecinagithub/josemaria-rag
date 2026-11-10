#!/usr/bin/env node
/**
 * Fusiona varios results-*.json parciales de la batería en uno solo.
 * Uso: node tests/grounding/merge-results.mjs <salida.json> <parte1.json> <parte2.json> …
 * Si un caso aparece en más de un fichero, gana el último (re-ejecuciones).
 */
import { readFile, writeFile } from 'node:fs/promises';

const [out, ...inputs] = process.argv.slice(2);
if (!out || !inputs.length) { console.error('uso: merge-results.mjs <salida> <parciales…>'); process.exit(2); }
const { cases } = JSON.parse(await readFile(new URL('./questions.json', import.meta.url), 'utf8'));
const order = new Map(cases.map((c, i) => [c.id, i]));
const byId = new Map();
for (const f of inputs) {
  const d = JSON.parse(await readFile(f, 'utf8'));
  for (const r of d.results) byId.set(r.id, r);
}
const results = [...byId.values()].sort((a, b) => order.get(a.id) - order.get(b.id));
await writeFile(out, JSON.stringify({ base: 'https://jpecina.duckdns.org/josemaria-rag', ranAt: new Date().toISOString(), mergedFrom: inputs, results }, null, 1));
console.log(`fusionados ${results.length} casos en ${out}`);
const missing = cases.filter((c) => !byId.has(c.id)).map((c) => c.id);
if (missing.length) console.log(`FALTAN: ${missing.join(', ')}`);
