export interface Citation {
  chunkId: string;
  chapter: string | null;
  printedPages: [number | null, number | null];
  pdfPages: [number, number];
}

export interface Evidence {
  chunkId: string;
  chapter: string | null;
  printedPages: [number | null, number | null];
  excerpt: string;
}

export interface ChatResponse {
  sessionId: string;
  answer: string;
  citations: Citation[];
  evidence: Evidence[];
  intent: string;
  mode: string;
}

export interface BookInfo {
  title: string;
  author: string;
  totalPdfPages: number;
  totalChunks: number;
  chapters: { chapter: string; chunks: number; printed_from: number; printed_to: number }[];
}

// Rutas relativas: la página se sirve bajo /josemaria-rag/ y nginx
// reenvía /josemaria-rag/api/* al backend como /api/*.
const API = 'api';

export async function fetchBookInfo(): Promise<BookInfo | null> {
  try {
    const r = await fetch(`${API}/book/info`);
    if (!r.ok) return null;
    return (await r.json()) as BookInfo;
  } catch {
    return null;
  }
}

export async function fetchHistory(sessionId: string): Promise<{ role: string; content: string; citations: Citation[] | null; mode: string | null }[]> {
  try {
    const r = await fetch(`${API}/chat/${sessionId}`);
    if (!r.ok) return [];
    const data = await r.json();
    return data.messages ?? [];
  } catch {
    return [];
  }
}

export async function sendChat(sessionId: string | undefined, message: string): Promise<ChatResponse> {
  const r = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Error ${r.status}`);
  }
  return (await r.json()) as ChatResponse;
}
