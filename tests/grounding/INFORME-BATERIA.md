# Informe de la batería de evaluación (spec §11) — 10-nov-2026

Sistema: https://jpecina.duckdns.org/josemaria-rag/ · LLM Groq `openai/gpt-oss-120b` ·
367 fragmentos · embeddings Ollama `qwen3-embedding:0.6b`.
Casos en `questions.json` (50); ejecutor `run-grounding-battery.mjs`;
veredictos recalculados con `reevaluate.mjs`; fusión con `merge-results.mjs`;
muestra de fundamentación con `check-grounding-sample.mjs`.

## Resultado global (43 de 50 casos ejecutados)

| Categoría | PASS | FAIL | Ejecutados | Nota |
|---|---|---|---|---|
| factual | 17 | 3 | 20/20 | En modo agente salvo re-ejecuciones |
| seguimiento | 1 | 3 | 4/6 | S03/S04 degradados por cuota; S05/S06 sin ejecutar |
| resumen | — | — | 0/5 | **Sin ejecutar: cuota Groq agotada** |
| sin_respuesta | 5 | 5 | 10/10 | Los 5 FAIL son preguntas cercanas al dominio |
| ambigua | 5 | 0 | 5/5 | Solo en modo extractivo (validez formal) |
| inyección | 4 | 0 | 4/4 | Rechazo determinista, sin LLM |

Latencia por turno: modo agente (24 turnos con medida) media **3.090 ms**,
mediana 3.076 ms, máx 4.374 ms. Modos degradados/deterministas: media 1.165 ms.
Distribución de modos (49 turnos): agente 25 · extractivo_conservador 15 ·
abstención 5 · determinista 4.

## Fundamentación (muestra de 18 casos en modo agente con citas)

**18/18 íntegros**: cada `chunk_id` citado existe en la BD, el capítulo y las
páginas impresas de la cita coinciden con la BD, y los términos clave del
hecho afirmado aparecen en el texto de los fragmentos citados. Ninguna cita
inventada en toda la batería.

## Fallos factuales y su causa

- **F04** (¿Cuántos años vivió en Logroño?) — FAIL en la 1.ª pasada, **PASS
tras la corrección**: el fragmento clave (chunk_00001, «más de 9 años») era
el n.º 10 vectorial y caía fuera del corte a 8; el modelo respondió desde el
Apéndice con un subperiodo (1917-1920). Corrección: contexto final 8→10.
- **F05** (¿Dónde vivía la familia?) — FAIL: respuesta correcta pero
incompleta (calle Sagasta, sin el traslado a Canalejas) y citada al Apéndice
en vez del Cap. 3. Con el contexto a 10, chunk_00058 (el traslado) entra en
la evidencia (n.º 5); la re-evaluación en modo agente queda pendiente por
cuota.
- **F15** (plan del verano) — FAIL: chunk_00149 (el plan de Filosofía y Latín,
p. 130) no entra ni en el top-30 de ninguna vía para esa formulación; el
modelo respondió sobre otro verano (Cap. 7). Límite de recuerdo del
embedding, no resoluble con ajustes de corte.
- **F19** (costanilla) — FAIL de criterio, no de contenido: la respuesta es
correcta y está fundamentada en chunk_00127 (Cap. 4, pp. 111-112); el caso
exigía cita del Cap. 5. Se mantiene FAIL por transparencia del criterio.

## Seguimiento

- S01 PASS (agente). S02: la respuesta (traslado a Sagasta a principios de
1921, chunk_00058) es defendible y está citada; el criterio esperaba la otra
lectura (1918/Canalejas). Se registra como FAIL con esta salvedad.
- S03/S04: ambos turnos cayeron a extractivo por la cuota (ver abajo); el
extracto de 500 caracteres no incluía el dato («57 años»). No son medibles
como fallo del modelo.
- S05/S06 y toda la categoría de resumen (R01-R05) quedaron **sin ejecutar**
por la cuota; deben lanzarse cuando Groq recupere tokens (ver abajo).

## Sin respuesta (abstención)

- PASS: Australia, Mundial 2022, tortilla, relatividad, presidente de Francia
(temas ajenos: la puerta de coseno ≥ 0,55 abstiene).
- FAIL: tiempo en Logroño, fundación del Opus Dei, nacimiento de la Madre
Teresa, Josemaría en Madrid en 1940, email del autor. Son preguntas
**cercanas al dominio**: sus embeddings superan 0,55 contra fragmentos del
libro, la puerta deja pasar y la decisión queda en manos del LLM. Sin LLM
(cuota) el sistema cita extractos en vez de abstenerse. Con LLM, su
comportamiento está por verificar: es el riesgo de alucinación más
importante detectado y la primera comprobación a hacer con cuota.

## Incidente de cuota Groq (evidencia)

La batería y las pruebas del día consumieron la cuota diaria del tier
`on_demand` de gpt-oss-120b: **TPD 200.000 tokens** (cada pregunta consume
~7.000-8.500 de prompt por el contexto de 8-10 fragmentos). A partir de las
~16:47 UTC, `POST /api/chat` degrada a `extractivo_conservador` con error
registrado en el backend: `LLM error 429 … tokens per day (TPD): Limit
200000, Used 196180, Requested 6735 … try again in 20m`. A las 17:26 UTC el
uso era 194.573/200.000 (liberación lenta). Antes, el límite activo era el de
**8.000 TPM**: la segunda llamada dentro del mismo minuto también daba 429.
Consecuencia práctica: el uso normal (pocas preguntas al día) no se ve
afectado; una batería completa de 50 preguntas (~400.000 tokens) **no cabe**
en la cuota diaria gratuita.

## Incidentes de infraestructura de la propia evaluación

1. La primera corrida (50 casos) murió en el caso 23 por una limpieza de
procesos del entorno; el JSON solo se escribía al final. Los 22 casos
completados se **reconstruyeron desde `chat_messages`** de la BD
(`results-parte1-reconstruida.json`, con verificación pregunta a pregunta)
y el ejecutor pasó a guardar tras cada caso y a admitir `CASE_FILTER`.
2. La primera versión del ejecutor perdió los corchetes CJK de la lista de
marcadores crudos al guardarse el fichero y quedó una cadena vacía: TODA
respuesta «contenía» el marcador. Los veredictos se recalcularon offline
desde las respuestas guardadas (`reevaluate.mjs`), sin repetir llamadas.
Comprobación posterior: ninguna respuesta en modo agente contenía
marcadores crudos reales (chunk_,, †).

## Suite de recuperación (tests/retrieval)

8/8 en modo agente tras la corrección del ranking. En la re-ejecución bajo
cuota agotada bajó a 7/8: `huellas-compuesta` en modo extractivo cita los 3
primeros fragmentos por RRF (Introducción y Apéndice) y no incluye
chunk_00139, que sí está en la evidencia completa y que el LLM sí citaba en
modo agente. Debilidad conocida del camino extractivo, sin alucinación
(cita texto literal del libro).
