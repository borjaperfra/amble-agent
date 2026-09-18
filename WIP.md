# Dónde nos quedamos — 18 septiembre 2026

Todo lo de hoy está commiteado, de `5695d19` a `442f355`.
Bórrame cuando esto esté cerrado.

## Cómo retomar

```bash
cd C:\dev\amble
npm run dev                 # http://localhost:3000
npm run check:model         # comprueba el modelo en 2 llamadas cortas
npm run measure -- <cv.pdf> # sesión entera por API, cronometrada
```

- Traza completa del grafo: http://localhost:3000/dev/user-zero
- Empezar de cero: borrar la carpeta `.amble-data/`
- `.env.local` ya tiene la API key de Helmcode

## Configuración del modelo (cerrada)

`deepseek-v4-flash` contra `https://api.helmcode.com/v1`, con
`AMBLE_MODEL_JSON_MODE=off` y `AMBLE_MODEL_REASONING=on`.

Verificado: responde en 2,6 s, devuelve JSON limpio sin JSON mode, y
`reasoning_content` llega de verdad. El servidor **sí acepta**
`response_format` con deepseek (no da 400), pero lo dejamos apagado porque el
spec solo lo garantiza en qwen3.6 y gemma4.

`qwen3.6` sí razona, con `chat_template_kwargs: { enable_thinking: true }`,
por si algún día hay que comparar en serio.

## Amble se usa desde el móvil

Decidido el 18 de septiembre: el uso principal será desde el teléfono, y el
destino es un agente de WhatsApp/Telegram. Eso manda sobre el diseño:

- Nada de trabajo dentro de una petición. La cola vive en SQLite (tabla
  `jobs`), reintenta sola (5 s, 20 s, 1 min, 3 min, 10 min) y recupera lo que
  quedara a medias cuando el proceso muere.
- `/api/interview/next` nunca espera al modelo: devuelve `WAIT` y encola. El
  cliente vuelve a preguntar cada 1,5 s.
- Mandar la misma respuesta dos veces es seguro; el servidor lo trata como
  tartamudeo de red, así que el cliente reintenta solo sin perder lo escrito.
- Planificar la pregunta se salta la cola: es lo único que el candidato está
  esperando de verdad.

- El procesado del CV también corre en la cola, así que ya no queda ningún
  trabajo dentro de una petición.

Se probó solo, por accidente: el tren entró en zona muerta a mitad de una
evaluación (ECONNRESET, luego ETIMEDOUT, luego ENOTFOUND — ni DNS). El job se
fue a su cuarto intento, el CV siguió leído, y al volver la señal terminó
solo. Nadie tocó nada.

## El arnés de medición

`scripts/measure-run.mjs` hace una sesión entera contra las rutas HTTP: sube
el CV, lanza el procesado y lo sigue por `state`, y contesta la entrevista
con respuestas que
escribe el propio modelo haciendo del candidato del CV. Cronometra cada
tramo, espera los `WAIT` como haría el navegador, marca las preguntas que se
repiten literalmente, y al acabar vuelca claims, evidencias, capacidades,
incertidumbres y latencia por tarea. Transcripción en
`.amble-data/measure-run.json`.

Las respuestas son sintéticas, y además llegan en diez segundos: un candidato
real tarda más en escribir, así que la cola le da tiempo a preparar la
siguiente pregunta y los tiempos reales serán mejores que los medidos.

## Números

| | Primera sesión | Última tanda |
| --- | --- | --- |
| Claims del CV | 104 | 25 |
| Capacidades | — | 8 |
| Incertidumbres del primer pase | 56 | 16 |
| Antes de la primera pregunta | 100 s | 26 s |
| Respuesta → siguiente pregunta | 45 s de media | 0,1 s con la cola caliente |
| Preguntas repetidas | 3 temas repetidos | 0 |
| Preguntas hasta que el Rep para solo | — | 6 |

La última tanda se midió con la conexión de un tren: `plan_question` pasó de
8,1 s a 23,7 s de media y un pico de 237 s entre pregunta y pregunta. Una de
las 19 llamadas al modelo falló y se recuperó sola — la sesión no se rompió,
que era justo lo que se buscaba. **Los tiempos hay que volver a tomarlos con
wifi estable**; lo que sí es comparable es el resto de la tabla.

## Cuatro bugs, todos de la misma familia

Tres de ellos eran el mismo fallo con distinta ropa: el modelo nombra un
campo como le parece y el normalizador lo tira al suelo en silencio.

1. **La segunda pregunta salía idéntica a la primera.** El planificador solo
   miraba turnos contestados, así que la pregunta preparada por adelantado le
   era invisible.
2. **Una conexión cortada mataba la etapa entera.** El reintento del provider
   solo cubría respuestas mal formadas, no fallos de transporte.
3. **Las capacidades salían a cero en silencio** (`assessmentLevel` en vez de
   `assessment`).
4. **Las incertidumbres salían a cero en silencio** (`text` en vez de
   `description`).

De 3 y 4 salió la regla: una lista que se normaliza hasta quedarse vacía es
un fallo de esquema, no un resultado. Se reintenta y luego falla a la vista.
Y el lector de prosa, cuando no reconoce ninguna llave, se queda con el campo
de texto más largo del objeto en vez de perder la respuesta.

## Siguiente paso

Volver a medir con wifi estable. Todos los tiempos de aquí se tomaron en un
tren y el modelo pasó de 8 s a 24 s de media por esa razón, no por el código.

## Hecho después de la tabla

**La cola tiene dos carriles.** Planificar una pregunta tarda 5 s; meter una
respuesta en el grafo, 40. Con un solo carril el candidato pagaba los dos,
porque una cola solo consulta su orden *entre* trabajos y nunca interrumpe el
que corre. Medido sobre seis preguntas: de 25,7 s de media y 52,8 s el peor,
a **1,9 s y 3,4 s**. A cambio, el planificador puede leer un grafo un minuto
desactualizado — ya lo hacía — y recibe las últimas preguntas y respuestas
directamente, que es lo que evita que se repita.

**El procesado también corre en la cola.** `POST /api/onboarding/process`
encola y vuelve: 0,0 s donde antes eran 100. La pantalla pregunta a
`/api/onboarding/state`, que se reconstruye de lo guardado, así que el móvil
puede bloquearse, perder cobertura o recargar sin perder el hilo.

**Entrada:** arrastrar ficheros sobre toda la página, varios a la vez, copy
que cambia mientras lee, y DOCX sin dependencia nueva (un .docx es un ZIP y
Node ya trae inflate). Probado con un .docx real: 10.962 caracteres, 37
claims, 8 capacidades, 16 incertidumbres.

## No empezado

**Cierre:** completitud y siguientes pasos en el Mapa; preferencias
estructuradas (salario, remoto, tecnologías, ubicación, etapa); y la pantalla
de listening explicando qué pasa a partir de ahora, con el canal de aviso
(WhatsApp / correo / ambos). El copy de esa pantalla ya está acordado.

**Voz:** STT con Whisper contra `/audio/transcriptions`. Las variables ya
están en `.env.example` pero todavía no las lee nadie. Límite del endpoint:
25 MB y ~2 minutos por request, más devuelve 524.
