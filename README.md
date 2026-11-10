# RAG «San Josemaría en La Rioja»

Chatbot documental especializado en un único libro: **«Josemaría Escrivá en
Logroño (1915-1925)»**, de Jaime Toldrá Parés (Ediciones Rialp, 2007).
Arquitectura RAG (Retrieval-Augmented Generation) según la especificación
v1.0: el asistente responde **solo** con el contenido del libro, cita las
páginas impresas que respaldan cada respuesta y se abstiene cuando el libro
no contiene la respuesta.

> Proyecto independiente: no comparte código, base de datos ni rutas con
> ningún otro proyecto del servidor.

## Arquitectura

| Capa | Tecnología | Función |
|---|---|---|
| Frontend | Vite + React + TypeScript | Interfaz de chat (la sirve el propio backend) |
| Backend | Node.js + Fastify + TypeScript | API, seguridad y lógica RAG |
| Base de datos | PostgreSQL 16 + pgvector (contenedor propio) | Texto, metadatos y vectores |
| Embeddings | Ollama + `qwen3-embedding:0.6b` (1024 dims) | Semántica local, en el host (`rag-ollama`) |
| LLM | Groq API (`llama-3.3-70b-versatile`) tras interfaz de proveedor | Redacción de respuestas |
| Extracción PDF | PDF.js | Lectura y paginación (página PDF e impresa) |
| Despliegue | Docker Compose + nginx del host | Ruta pública `/josemaria-rag/` |

Búsqueda **híbrida**: similitud coseno exacta en pgvector + Full Text Search
en español de PostgreSQL, fusionadas con **RRF (k=60)** (10 candidatos por
vía → 5-8 fragmentos finales). Sin índice HNSW en v1.0 (spec §4).

## Comportamiento

- **Clasificador de intención**: saludos/cortesías con respuesta
  determinista (sin LLM ni RAG); preguntas factuales; seguimientos con
  resolución de contexto desde la sesión; resúmenes con muestreo por
  capítulo; abstención sin evidencia con el texto exacto de la spec;
  rechazo de inyecciones de instrucciones.
- **System prompt**: el de la spec §5.2, literal.
- **Verificación posterior**: los identificadores de fragmento que cita el
  LLM deben estar entre los recuperados; el backend los convierte en
  páginas impresas. Si la verificación falla, se degrada a una respuesta
  extractiva conservadora con los mejores pasajes.
- **Sin clave de Groq** (`GROQ_API_KEY` vacía): el backend arranca,
  `/api/health` responde y `/api/chat` trabaja en modo «solo recuperación»:
  informa de que la generación no está configurada y muestra los
  fragmentos recuperados con sus páginas, sin inventar redacción.

## Estructura

```
apps/frontend/   Vite + React + TS (chat)
apps/backend/    Fastify + TS (API, ingestión, recuperación, orquestador)
infra/           Migración SQL y bloque nginx de la ruta pública
data/            book.pdf e informes de ingestión (NO versionados)
tests/           Bancos de preguntas de recuperación y grounding
docker-compose.yml
```

## Puesta en marcha (servidor)

```bash
cp .env.example .env   # rellenar POSTGRES_PASSWORD y ADMIN_TOKEN (Groq opcional)
mkdir -p data && cp /ruta/al/libro.pdf data/book.pdf
docker compose up -d --build
docker compose exec backend node dist/ingestion/ingest.js   # ingestión completa
curl http://127.0.0.1:8100/api/health
```

Ruta pública: añadir `infra/nginx-location.conf` al site de
`jpecina.duckdns.org` → `https://jpecina.duckdns.org/josemaria-rag/`.

**Nota sobre Ollama**: `rag-ollama` vive en la red bridge por defecto del
host y solo publica en su `127.0.0.1:11434`; Docker no permite unir un
servicio de compose a esa red («network-scoped aliases are only supported
for user-defined networks») y el cortafuegos del host rechaza el tráfico
contenedor→pasarela salvo puertos aceptados. Por eso el compose incluye
un servicio `ollama-bridge` (red del host) que escucha solo en la
pasarela de la red del proyecto (172.30.77.1:11434, subred fijada en el
compose) y reenvía al Ollama del host, y el host necesita la regla de
cortafuegos de `infra/firewall-ollama-bridge.sh` (acotada a la subred
del proyecto y a ese puerto, persistida con netfilter-persistent).

## API

| Endpoint | Método | Función |
|---|---|---|
| `/api/chat` | POST | Enviar pregunta (`{message, sessionId?}`) |
| `/api/chat/:sessionId` | GET | Historial de la conversación |
| `/api/book/info` | GET | Libro, capítulos y estado de indexación |
| `/api/admin/book` | POST | Subir PDF (cabecera `x-admin-token`) |
| `/api/admin/reindex` | POST | Reconstruir el índice (admin) |
| `/api/admin/ingestion-status` | GET | Progreso de la ingestión (admin) |
| `/api/health` | GET | Salud: BD, Ollama, LLM, nº de fragmentos |

## Pruebas

```bash
BASE_URL=https://jpecina.duckdns.org/josemaria-rag node tests/retrieval/run-retrieval-smoke.mjs
```

## Notas documentales

- El PDF (327 páginas) tiene texto seleccionable; no requiere OCR.
- Las citas usan la **página impresa**: el desplazamiento detectado entre
  página PDF y página impresa es **+1** (votación de 285 cabeceras).
- Rango indexado: páginas PDF 10-315 (Introducción → fin del Apéndice).
  Las páginas de portadilla de parte y las láminas sin texto quedan
  registradas en el informe de ingestión (`data/ingestion-report.json`).
