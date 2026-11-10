# Pruebas de grounding (fundamentación)

Objetivo: comprobar que cada afirmación del asistente está respaldada por
fragmentos reales del libro y que las citas apuntan a páginas existentes.

Banco ampliado pendiente de ejecutar cuando el LLM (Groq) esté configurado:
50 preguntas — factuales, ambiguas, sin respuesta en el libro, de
seguimiento e inyecciones de instrucciones — con verificación automática
de que el 100 % de las citas corresponden a fragmentos recuperados
(`chunk_id` presentes en `document_chunks`) y revisión manual de una
muestra de respuestas.

Casos ya cubiertos de forma automática en `tests/retrieval/`:
huellas en la nieve (Cap. 5, pp. impresas 123-124), relación con Logroño,
domicilio familiar, muerte de don José (Cap. 9), abstención ante un tema
ajeno (relatividad), saludo sin RAG e inyección rechazada.
