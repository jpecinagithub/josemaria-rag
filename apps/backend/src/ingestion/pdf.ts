import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedPage {
  pdfPage: number;
  text: string; // texto limpio, sin cabeceras/pies repetidos
  rawHead: string; // primeras líneas antes de limpiar cabeceras (para detectar capítulos)
  printedCandidate?: number;
}

const VIRTUAL_LIBRARY_LINE = 'Biblioteca Virtual Josemaría Escrivá de Balaguer y Opus Dei';

// Cabeceras repetidas (títulos corridos) que no forman parte del texto útil.
const RUNNING_HEADS = new Set([
  'INTRODUCCIÓN',
  'ESTUDIOS ECLESIÁSTICOS',
  'LA VIDA EN LOGROÑO',
  'ENTRE LOGROÑO Y ZARAGOZA (1920-1925)',
  'APÉNDICE DOCUMENTAL',
  'SUCINTA CRONOLOGÍA DE JOSEMARÍA ESCRIVÁ HASTA 1925',
  'LAS HUELLAS EN LA NIEVE Y LA DECISIÓN DE SER SACERDOTE',
  'LOGROÑO A PRINCIPIOS DEL SIGLO XX (1915-1925)',
  'INSPECTOR DEL SEMINARIO DE SAN FRANCISCO DE PAULA (1922-1924)',
  'FALLECIMIENTO REPENTINO DE DON JOSÉ ESCRIVÁ (1924)',
  'JOSEMARÍA ESCRIVÁ EN EL SEMINARIO DE LOGROÑO',
  'JOSEMARÍA ESCRIVÁ EN EL INSTITUTO DE LOGROÑO',
  'LA DIÓCESIS DE CALAHORRA Y LA CALZADA-LOGROÑO',
]);

function isRunningHead(rest: string): boolean {
  const letters = rest.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letters.length < 3) return false;
  const upper = rest.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length;
  return upper / Math.max(letters.length, 1) > 0.6;
}

/** Extrae el número de página impresa de la cabecera y elimina la línea de cabecera si lo es. */
function stripHeader(lines: string[]): { lines: string[]; printed?: number } {
  const out = [...lines];
  let printed: number | undefined;
  for (let i = 0; i < Math.min(3, out.length); i++) {
    const line = out[i].trim();
    let m = line.match(/^(\d{1,3})$/);
    if (m) {
      printed = Number(m[1]);
      out.splice(i, 1);
      break;
    }
    m = line.match(/^(\d{1,3})\s+(.+)$/);
    if (m && isRunningHead(m[2])) {
      printed = Number(m[1]);
      out.splice(i, 1);
      break;
    }
    m = line.match(/^(.+?)\s+(\d{1,3})$/);
    if (m && isRunningHead(m[1])) {
      printed = Number(m[2]);
      out.splice(i, 1);
      break;
    }
    if (line.length > 0) break;
  }
  return { lines: out, printed };
}

export function cleanPageText(raw: string): { text: string; printedCandidate?: number } {
  const normalized = raw.replaceAll('C APÍTULO', 'CAPÍTULO');
  let lines = normalized.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  lines = lines.filter((l) => l !== VIRTUAL_LIBRARY_LINE && !l.startsWith('Biblioteca Virtual Josemaría'));
  const stripped = stripHeader(lines);
  lines = stripped.lines.filter((l) => !RUNNING_HEADS.has(l));
  // Unir líneas en párrafos: desguionado de palabras cortadas y flujo continuo.
  const paragraphs: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) paragraphs.push(current.trim());
    current = '';
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    if (!current) {
      current = t;
    } else if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]-$/.test(current) && /^[a-záéíóúüñ]/.test(t)) {
      current = current.slice(0, -1) + t;
    } else {
      current += ' ' + t;
    }
  }
  flush();
  return { text: paragraphs.join('\n\n'), printedCandidate: stripped.printed };
}

interface TextItemLike {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
}

/**
 * Reconstruye las líneas agrupando los items de PDF.js por su coordenada Y
 * (el orden del flujo de contenido no es el orden de lectura: cabeceras,
 * marcas de agua y pies llegan desordenados).
 */
function itemsToLines(items: TextItemLike[]): string {
  const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const lines: { y: number; h: number; parts: { x: number; w: number; str: string }[] }[] = [];
  for (const it of sorted) {
    const y = it.transform[5];
    const x = it.transform[4];
    let line = lines[lines.length - 1];
    if (!line || Math.abs(line.y - y) > 2.5) {
      line = { y, h: it.height ?? 10, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, w: it.width ?? 0, str: it.str });
  }
  const out: string[] = [];
  let prevY: number | null = null;
  let prevH = 10;
  for (const line of lines) {
    const parts = [...line.parts].sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = -Infinity;
    for (const p of parts) {
      if (text && p.x > prevEnd + 1.5 && !text.endsWith(' ') && !p.str.startsWith(' ')) text += ' ';
      text += p.str;
      prevEnd = Math.max(prevEnd, p.x + p.w);
    }
    if (prevY !== null && prevY - line.y > Math.max(prevH, line.h) * 1.9) out.push('');
    out.push(text);
    prevY = line.y;
    prevH = line.h;
  }
  return out.join('\n');
}

export async function extractPdf(pdfPath: string): Promise<{ totalPages: number; pages: ExtractedPage[] }> {
  const data = new Uint8Array(await readFile(pdfPath));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: ExtractedPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const raw = itemsToLines(tc.items as TextItemLike[]);
    const { text, printedCandidate } = cleanPageText(raw);
    pages.push({ pdfPage: p, text, rawHead: raw.replaceAll('C APÍTULO', 'CAPÍTULO').slice(0, 600), printedCandidate });
  }
  return { totalPages: doc.numPages, pages };
}

/** Calcula el desplazamiento PDF→impresa por votación mayoritaria de las cabeceras detectadas. */
export function computeOffset(pages: ExtractedPage[]): { offset: number; votes: number } {
  const counts = new Map<number, number>();
  for (const p of pages) {
    if (p.printedCandidate === undefined) continue;
    const off = p.printedCandidate - p.pdfPage;
    if (Math.abs(off) <= 6 && p.printedCandidate >= 1 && p.printedCandidate <= 400) {
      counts.set(off, (counts.get(off) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestCount = 0;
  for (const [off, c] of counts) {
    if (c > bestCount) {
      best = off;
      bestCount = c;
    }
  }
  return { offset: best, votes: bestCount };
}

export const CHAPTER_STARTERS: { pattern: RegExp; chapter: string }[] = [
  { pattern: /^INTRODUCCIÓN\b/, chapter: 'Introducción' },
  { pattern: /SUCINTA CRONOLOGÍA/, chapter: 'Sucinta cronología hasta 1925' },
  { pattern: /CAPÍTULO PRIMERO/, chapter: 'Capítulo 1 — Logroño a principios del siglo XX (1915-1925)' },
  { pattern: /CAPÍTULO SEGUNDO/, chapter: 'Capítulo 2 — La diócesis de Calahorra y La Calzada-Logroño' },
  { pattern: /CAPÍTULO TERCERO/, chapter: 'Capítulo 3 — La vida en Logroño' },
  { pattern: /CAPÍTULO CUARTO/, chapter: 'Capítulo 4 — Josemaría Escrivá en el Instituto de Logroño' },
  { pattern: /CAPÍTULO QUINTO/, chapter: 'Capítulo 5 — Las huellas en la nieve y la decisión de ser sacerdote' },
  { pattern: /CAPÍTULO SEXTO/, chapter: 'Capítulo 6 — Josemaría Escrivá en el Seminario de Logroño' },
  { pattern: /CAPÍTULO SÉPTIMO/, chapter: 'Capítulo 7 — Alumno de la Universidad Pontificia de Zaragoza (1920-1922)' },
  { pattern: /CAPÍTULO OCTAVO/, chapter: 'Capítulo 8 — Inspector del Seminario de San Francisco de Paula (1922-1924)' },
  { pattern: /CAPÍTULO NOVENO/, chapter: 'Capítulo 9 — Fallecimiento repentino de don José Escrivá (1924)' },
  { pattern: /APÉNDICE DOCUMENTAL/, chapter: 'Apéndice documental' },
];

export function detectChapter(text: string): string | null {
  const head = text.slice(0, 600);
  for (const s of CHAPTER_STARTERS) {
    if (s.pattern.test(head)) return s.chapter;
  }
  return null;
}
