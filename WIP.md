# Dónde nos quedamos — 18 septiembre 2026

Trabajo a medias, **sin commitear**. Todo está en el árbol, nada se pierde.
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

## El arnés de medición

`scripts/measure-run.mjs` hace una sesión entera contra las rutas HTTP: sube
el CV, lanza las tres etapas, y contesta la entrevista con respuestas que
escribe el propio modelo haciendo del candidato del CV. Cronometra cada
tramo, cuenta repeticiones literales, y al acabar vuelca claims, evidencias,
capacidades, incertidumbres y latencia por tarea desde la base de datos.
Deja la transcripción completa en `.amble-data/measure-run.json`.

Las respuestas son sintéticas: sirven para juzgar ritmo, repetición y cuántas
incertidumbres sobreviven al primer pase, no la calidad de lo que Amble
aprende de una persona real.

## Tres bugs que encontró, y su arreglo

**1. La segunda pregunta salía palabra por palabra igual que la primera.**
`planOneQuestion` solo miraba turnos *contestados* para la lista
antirrepetición y para el guardia de casi-duplicados. La pregunta que el
buffer prepara por adelantado era invisible, así que se planificaba contra el
mismo terreno. Ahora las preguntas en cola cuentan como hechas, sus
incertidumbres quedan reservadas, y un calco se descarta sin dar la
entrevista por terminada (antes, una colisión del prefetch la cerraba).

**2. Una conexión cortada mataba la etapa entera.** El bucle de reintentos de
`provider.ts` solo cubría respuestas malas (JSON inválido, esquema, truncado);
un fallo de transporte se lanzaba en seco. Ahora `ModelError` lleva
`retryable`: red caída y HTTP 429/5xx se reintentan hasta 3 veces con espera
creciente; 400/401/403 fallan al momento. El "tu respuesta anterior falló la
validación" ya no se cuela cuando no hubo respuesta anterior. El error guarda
el código de debajo (`ECONNRESET`, `ETIMEDOUT`…), no solo "fetch failed".

**3. La evaluación de capacidades devolvía cero en silencio.** El modelo
contestó `assessmentLevel` donde el normalizador esperaba `assessment`, así
que *todas* las capacidades se descartaban una por una: 0 capacidades, 0
incertidumbres, run marcado como correcto, y una entrevista preguntando
genéricas al vacío. Ahora se aceptan los alias, y una lista que se normaliza
hasta quedarse vacía es un fallo de esquema — se reintenta y luego falla a la
vista, no pasa por buena.

## Números

Primera sesión real (antes de esta tanda), CV de 4.313 caracteres:

| | |
| --- | --- |
| Antes de la primera pregunta | 100 s |
| Entre respuesta y siguiente pregunta | 45 s de media, 116 s el peor |
| Claims extraídos | 104 (el prompt pedía 10-40) |
| Incertidumbres | 56 creadas, 42 abiertas al final |
| Huecos mostrados en el Mapa | 35 |

Lo medido después, en tandas que se cortaron por la conexión del tren:

| | |
| --- | --- |
| Claims extraídos | 25-34 |
| Extracción | 28-61 s |
| Capacidades | 38-48 s |
| Antes de la primera pregunta | 4,7-6,4 s |
| Entre respuesta y siguiente pregunta | 0,0-0,1 s con la cola caliente |

**Falta la tanda limpia de punta a punta**, con wifi estable, para confirmar
las 6 preguntas seguidas sin repetir tema y cuántas incertidumbres deja el
primer pase.

## Siguiente paso exacto

1. `npm run dev`, borrar `.amble-data/`, y `npm run measure -- <cv.pdf>`
   entero con conexión estable. Leer `.amble-data/measure-run.json`.
2. Con esos números, decidir si el techo de 6 preguntas y el de 2
   incertidumbres por capacidad son los correctos.

## No empezado

**Entrada:** arrastrar ficheros, aceptar DOCX, punto verde animado, copy que
cambia mientras lee, hallazgos apareciendo al vuelo, y un final que deje claro
que hay que darle a continuar.

**Cierre:** completitud y siguientes pasos en el Mapa; preferencias
estructuradas (salario, remoto, tecnologías, ubicación, etapa); y la pantalla
de listening explicando qué pasa a partir de ahora, con el canal de aviso
(WhatsApp / correo / ambos). El copy de esa pantalla ya está acordado.

**Voz:** STT con Whisper contra `/audio/transcriptions`. Las variables ya
están en `.env.example` pero todavía no las lee nadie. Límite del endpoint:
25 MB y ~2 minutos por request, más devuelve 524.

**Resistencia a la red mala:** los reintentos aguantan un corte de segundos,
no un túnel de tres minutos. Si Amble se va a usar desde el móvil, la cola
debería reencolar el trabajo fallido y la pantalla decir "reintentando" en vez
de romper la sesión.
