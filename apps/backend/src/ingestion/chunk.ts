export interface PageSegment {
  pdfPage: number;
  printedPage: number;
  chapter: string;
  text: string;
}

export interface Chunk {
  chunkIndex: number;
  chunkId: string;
  chapter: string;
  pageStart: number;
  pageEnd: number;
  printedPageStart: number;
  printedPageEnd: number;
  content: string;
  tokensEst: number;
}

interface Sentence {
  text: string;
  pdfPage: number;
  printedPage: number;
  tokens: number;
}

export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words * 1.33);
}

const ABBREV: [RegExp, string][] = [
  [/\bpp\./g, 'pp§'],
  [/\bp\./g, 'p§'],
  [/\bSr\./g, 'Sr§'],
  [/\bSra\./g, 'Sra§'],
  [/\bDr\./g, 'Dr§'],
  [/\bo\.c\./g, 'oc§'],
  [/\bcfr\./gi, 'cfr§'],
  [/\bnúm\./g, 'núm§'],
  [/\bcap\./g, 'cap§'],
  [/\bss\./g, 'ss§'],
];

export function splitSentences(text: string, pdfPage: number, printedPage: number): Sentence[] {
  let t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  for (const [re, rep] of ABBREV) t = t.replace(re, rep);
  const parts = t.match(/[^.!?…]+(?:[.!?…]+["»”)]*)?/g) ?? [t];
  return parts
    .map((s) => s.replaceAll('§', '.').trim())
    .filter((s) => s.length > 1)
    .map((s) => ({ text: s, pdfPage, printedPage, tokens: estimateTokens(s) }));
}

const TARGET = 560;
const MIN = 450;
const MAX = 650;
const OVERLAP = 90;

/** Trocea por capítulos, respetando frases y párrafos, con solape entre fragmentos consecutivos. */
export function chunkSegments(segments: PageSegment[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;
  const chapters = new Map<string, Sentence[]>();
  for (const seg of segments) {
    if (!chapters.has(seg.chapter)) chapters.set(seg.chapter, []);
    const arr = chapters.get(seg.chapter)!;
    for (const para of seg.text.split('\n\n')) {
      arr.push(...splitSentences(para, seg.pdfPage, seg.printedPage));
    }
  }
  for (const [chapter, sentences] of chapters) {
    let current: Sentence[] = [];
    let currentTokens = 0;
    const flush = () => {
      if (!current.length) return;
      index += 1;
      const content = current.map((s) => s.text).join(' ');
      chunks.push({
        chunkIndex: index,
        chunkId: `chunk_${String(index).padStart(5, '0')}`,
        chapter,
        pageStart: Math.min(...current.map((s) => s.pdfPage)),
        pageEnd: Math.max(...current.map((s) => s.pdfPage)),
        printedPageStart: Math.min(...current.map((s) => s.printedPage)),
        printedPageEnd: Math.max(...current.map((s) => s.printedPage)),
        content,
        tokensEst: currentTokens,
      });
      // Solape: semilla del siguiente fragmento con las últimas frases (<= OVERLAP tokens)
      const seed: Sentence[] = [];
      let seedTokens = 0;
      for (let i = current.length - 1; i >= 0 && seedTokens < OVERLAP; i--) {
        seed.unshift(current[i]);
        seedTokens += current[i].tokens;
      }
      current = seed.length < current.length ? seed : [];
      currentTokens = current.reduce((a, s) => a + s.tokens, 0);
    };
    for (const s of sentences) {
      if (currentTokens >= MIN && currentTokens + s.tokens > MAX) flush();
      current.push(s);
      currentTokens += s.tokens;
      if (currentTokens >= TARGET && current.length > 1) {
        // se cerrará al añadir la siguiente frase si supera MAX, o al final
        if (currentTokens >= MAX) flush();
      }
    }
    // Cierre de capítulo: vaciar sin arrastrar solape al capítulo siguiente.
    // Si solo queda la semilla de solape (o un resto muy corto), se anexa al último fragmento.
    if (current.length && currentTokens < 120 && chunks.length && chunks[chunks.length - 1].chapter === chapter) {
      const last = chunks[chunks.length - 1];
      last.content += ' ' + current.map((s) => s.text).join(' ');
      last.pageEnd = Math.max(last.pageEnd, ...current.map((s) => s.pdfPage));
      last.printedPageEnd = Math.max(last.printedPageEnd, ...current.map((s) => s.printedPage));
      last.tokensEst += currentTokens;
      current = [];
      currentTokens = 0;
    }
    if (current.length) {
      index += 1;
      const content = current.map((s) => s.text).join(' ');
      chunks.push({
        chunkIndex: index,
        chunkId: `chunk_${String(index).padStart(5, '0')}`,
        chapter,
        pageStart: Math.min(...current.map((s) => s.pdfPage)),
        pageEnd: Math.max(...current.map((s) => s.pdfPage)),
        printedPageStart: Math.min(...current.map((s) => s.printedPage)),
        printedPageEnd: Math.max(...current.map((s) => s.printedPage)),
        content,
        tokensEst: currentTokens,
      });
      current = [];
      currentTokens = 0;
    }
  }
  return chunks;
}
