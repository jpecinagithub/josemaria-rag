import { config } from './config.js';

// Instrucción de recuperación recomendada para la familia Qwen3-Embedding:
// se aplica SOLO a las consultas; los fragmentos documentales se incrustan sin ella.
const QUERY_INSTRUCTION =
  'Instruct: Representa esta consulta para recuperar los pasajes de un libro ' +
  'histórico en español sobre san Josemaría Escrivá en Logroño (1915-1925) ' +
  'que permitan responderla.\nQuery: ';

export async function embedTexts(texts: string[], opts: { query?: boolean } = {}): Promise<number[][]> {
  const input = opts.query ? texts.map((t) => QUERY_INSTRUCTION + t) : texts;
  const res = await fetch(`${config.ollamaBaseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.embeddingModel, input }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { embeddings: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error('Ollama devolvió un número inesperado de embeddings');
  }
  for (const e of data.embeddings) {
    if (e.length !== config.embeddingDims) {
      throw new Error(`Dimensión inesperada de embedding: ${e.length} (esperadas ${config.embeddingDims})`);
    }
  }
  return data.embeddings;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [e] = await embedTexts([text], { query: true });
  return e;
}

export async function ollamaReady(): Promise<{ ok: boolean; models: string[] }> {
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/api/tags`);
    if (!res.ok) return { ok: false, models: [] };
    const data = (await res.json()) as { models?: { name: string }[] };
    return { ok: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { ok: false, models: [] };
  }
}

export function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}
