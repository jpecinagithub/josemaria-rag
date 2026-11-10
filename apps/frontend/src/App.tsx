import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchBookInfo, fetchHistory, sendChat, type BookInfo, type Citation, type Evidence } from './api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  evidence?: Evidence[];
  mode?: string;
}

const SUGGESTED = [
  '¿Qué relación tuvo san Josemaría con Logroño?',
  '¿Qué lugares de La Rioja aparecen en el libro?',
  '¿Qué personas se mencionan durante esta etapa?',
  '¿Dónde vio las huellas en la nieve?',
];

const SESSION_KEY = 'josemaria-rag-session';

function pagesLabel(p: [number | null, number | null]): string {
  const [a, b] = p;
  if (a === null) return '';
  if (b === null || a === b) return `p. ${a}`;
  return `pp. ${a}-${b}`;
}

function Citations({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="citations">
      <span className="citations-title">Fuentes:</span>
      {citations.map((c) => (
        <span key={c.chunkId} className="chip" title={c.chapter ?? ''}>
          {pagesLabel(c.printedPages)}
          {c.chapter ? ` · ${c.chapter.split('—')[0].trim()}` : ''}
        </span>
      ))}
    </div>
  );
}

function EvidenceBlock({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <details className="evidence">
      <summary>Ver fragmentos originales del libro</summary>
      {evidence.map((e) => (
        <blockquote key={e.chunkId}>
          <p>{e.excerpt}…</p>
          <footer>
            {e.chapter ?? ''} · {pagesLabel(e.printedPages)}
          </footer>
        </blockquote>
      ))}
    </details>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<BookInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(() => localStorage.getItem(SESSION_KEY) ?? undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchBookInfo().then(setBook);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetchHistory(sessionId).then((msgs) => {
      if (msgs.length) {
        setMessages(
          msgs.map((m) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
            citations: m.citations ?? undefined,
            mode: m.mode ?? undefined,
          })),
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;
    setError(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setLoading(true);
    try {
      const res = await sendChat(sessionId, message);
      setSessionId(res.sessionId);
      localStorage.setItem(SESSION_KEY, res.sessionId);
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.answer, citations: res.citations, evidence: res.evidence, mode: res.mode },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido contactar con el asistente.');
    } finally {
      setLoading(false);
    }
  }

  function newConversation() {
    localStorage.removeItem(SESSION_KEY);
    setSessionId(undefined);
    setMessages([]);
    setError(null);
  }

  return (
    <div className="page">
      <header className="header">
        <p className="header-kicker">Asistente documental</p>
        <h1>San Josemaría en La Rioja</h1>
        <p className="header-sub">Explora la historia a través del libro</p>
        <p className="header-desc">
          Haz preguntas sobre personas, lugares y acontecimientos relatados en la obra.
          Las respuestas se elaboran exclusivamente a partir de su contenido y citan las páginas.
        </p>
        {book && (
          <p className="header-book">
            «{book.title}» — {book.author} · {book.totalChunks} fragmentos indexados
          </p>
        )}
      </header>

      <main className="chat">
        {messages.length === 0 && (
          <section className="suggested">
            <h2>Preguntas sugeridas</h2>
            <div className="suggested-grid">
              {SUGGESTED.map((q) => (
                <button key={q} className="suggested-btn" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </section>
        )}

        {messages.map((m, i) => (
          <article key={i} className={m.role === 'user' ? 'msg msg-user' : 'msg msg-assistant'}>
            {m.role === 'assistant' ? (
              <>
                {m.mode === 'solo_recuperacion' && <p className="mode-badge">Modo de solo recuperación: generación no configurada</p>}
                <div className="markdown">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
                {m.citations && <Citations citations={m.citations} />}
                {m.evidence && <EvidenceBlock evidence={m.evidence} />}
              </>
            ) : (
              <p>{m.content}</p>
            )}
          </article>
        ))}

        {loading && <p className="thinking">Consultando el libro…</p>}
        {error && <p className="error">{error}</p>}
        <div ref={bottomRef} />
      </main>

      <footer className="composer">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pregunta sobre el libro..."
            aria-label="Pregunta sobre el libro"
            maxLength={2000}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            Preguntar
          </button>
          <button type="button" className="ghost" onClick={newConversation}>
            Nueva conversación
          </button>
        </form>
      </footer>
    </div>
  );
}
