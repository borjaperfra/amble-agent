# Dónde nos quedamos — 19 septiembre 2026

Todo commiteado, de `5695d19` en adelante. Árbol limpio, `tsc` y `eslint` en
verde. Bórrame cuando esto esté cerrado.

## Opportunity Zero — empezado el 19, a medio camino

La pregunta: **¿sabe Amble cuándo una oportunidad merece interrumpirte?**

No es sourcing, no es el producto para empresas, no es un tablón de ofertas.
Es el primer experimento de match e interrupción, y no tapa el agujero de
abajo (sigue sin llegar nada): responde a la otra mitad, si sabríamos qué
hacer con una oferta el día que llegue.

Estado: `tsc` y `eslint` en verde. **No se ha ejecutado ni una sola vez contra
el modelo.** Falta `next build`, faltan los tests y falta la pantalla que lo
enseña. Todo lo de "hecho" está escrito y compila; nada está probado.

### Hecho

- **Dominio puro** en `src/domains/opportunity/`: `types.ts`, `rules.ts`,
  `prompts.ts`. Cero dependencias de la base, del provider o de Next, para que
  las reglas que protegen la atención se lean y se prueben solas.
- **Cuatro tareas de modelo** en `src/lib/model/opportunity-tasks.ts`:
  rúbrica → match → decisión → explicación. Cada una versionada, con
  normalización tolerante: los nombres de campo se mueven entre runs, y una
  lista que se normaliza hasta quedarse vacía falla y se reintenta — la misma
  regla que salió de los cuatro bugs de User Zero.
- **Esquema nuevo** en `db.ts`: `opportunities`, `opportunity_rubrics`,
  `opportunity_assessments`, `opportunity_decisions`, `opportunity_labels`,
  `opportunity_responses` y `audit_events` (append-only; el spec lo pedía en
  §19 y no existía).
- **Repo aparte** en `src/lib/db/opportunities.ts`. User Zero está congelado y
  no se toca: un experimento que igual se tira no se mete en el fichero que
  tiene la parte que funciona.
- **Pipeline** en `src/lib/pipeline/opportunities.ts`, por etapas reanudables
  sobre la cola (`evaluate_opportunity`, carril de fondo). Un reintento tras un
  corte no vuelve a pagar la rúbrica.
- **API**: `GET/POST /api/opportunities`, `POST /api/opportunities/[id]/response`.
- **Vista del laboratorio** en `src/lib/opportunity-view.ts` y el componente
  `OpportunityZeroLab.tsx`.
- **Diez fixtures** en `src/fixtures/opportunities.ts`, escritas contra el
  candidato de demo y sin imports a propósito (el harness es un `.mjs` y las
  carga directamente). No son diez buenos matches: son diez formas distintas
  de estar *casi* bien, que es lo que mide calibración.

### Falta

- `src/app/dev/opportunity-zero/page.tsx`. El componente del laboratorio está
  escrito pero huérfano: nadie lo renderiza todavía.
- La interrupción en la pantalla de listening. Solo INTERRUPT llega al
  candidato; HOLD e IGNORE no notifican nada, y eso es el producto, no una
  etapa pendiente.
- `scripts/measure-opportunities.mjs` y el script `measure:opportunities`.
- Tests con `node --test` y un hook de resolución en `scripts/` (cero
  dependencias nuevas). Ya comprobado que Node 22 hace type-stripping de `.ts`
  y que `node:test` los carga; falta el hook para los imports `@/` y sin
  extensión.
- `next build` y una pasada real contra deepseek.

### Decidido, no volver a abrirlo

- **El modelo propone, las reglas deciden.** Se guardan las dos
  (`model_decision` frente a `decision` + `override_reason`). Es la única
  forma de saber si algún día el modelo puede llevar esto solo, y la única de
  notar cuándo las equivocadas son las reglas.
- **Salario y modo de trabajo se comprueban en código** contra `preferences`.
  Geografía, tipo de rol y los "no" del candidato los propone el modelo y
  pasan por validación. Comparar strings de ciudades y llamarlo una decisión
  sería una precisión que no tenemos.
- **Lo que no se puede señalar no es un desajuste, es un desconocido.** Un
  veredicto positivo sin un `evidenceId` real baja a UNKNOWN, nunca a
  NOT_SUPPORTED. Que el modelo no cite no dice nada sobre la persona.
- **INTERRUPT se gana dos veces**: evidencia material citada *y* alineación
  con el intent citada. Una sola de las dos es HOLD.
- **HOLD tiene que decir qué lo resolvería.** Si el modelo no da una acción
  usable, el hueco que causó el hold ya lleva la pregunta dentro.
- **La etiqueta ciega vive en su propia tabla.** Los constructores de prompt
  son funciones puras cuyos argumentos no tienen campo para ella: se comprueba,
  no se promete.
- **Rechazar una oferta no toca el Intent Profile.** Un no es sobre ese puesto,
  no sobre la forma de todo lo que quieres.
- **La config del modelo sigue cerrada.** El prompt original decía "DeepSeek
  V4.1 Flash"; no se toca nada, el provider ya abstrae eso.

## Lo siguiente, cuando retomemos

**Una sesión real de Borja, entera, sin preparar nada antes.** Todo lo medido
hasta ahora lleva respuestas sintéticas que el modelo escribe en diez
segundos: una persona tarda más en escribir y contesta otras cosas. Es lo
único que dirá si las preguntas valen la pena.

Antes de esa sesión: borrar `.amble-data/`, que ahora tiene restos de pruebas
(el intent dice "Would consider 50k", que salió de una llamada mía a la API).

Y el agujero real del producto, que no es código de estas pantallas: **no
llega nada**. No hay fuente de ofertas que cruzar contra las preferencias. La
pantalla de listening lo dice en voz alta ("Nothing is arriving yet") en vez
de disimularlo, pero ahí está. Opportunity Zero no lo tapa — mete las ofertas
a mano — pero contesta la otra mitad de la pregunta.

## Decidido en User Zero, no volver a abrirlo

- El copy de la pantalla de listening se revisó el 18 de septiembre y **se
  queda como está**, incluidos los tres puntos de "FROM HERE". Repiten en
  parte la promesa de la línea grande de arriba, y aun así se quedan: dicen la
  mecánica concreta, que la promesa no dice.
- Arrastrar ficheros está **probado por Borja en su navegador**, funciona.

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

## Sobre los tiempos

Casi todos se tomaron con la conexión de un tren, y el modelo pasó de 8 s a
24 s de media por eso, no por el código. Sirven para comparar entre sí, no
como cifra absoluta.

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

**Cierre:** el Mapa abre con una línea de sobre qué se sostiene (fuentes,
evidencias, cuántas capacidades aguantan con evidencia buena, cuántas
preguntas siguen abiertas) y cierra con dos o tres cosas que lo afilarían. Los
huecos ya no se listan los dieciséis: se muestran cinco y se cuentan los
demás. Las preferencias estructuradas (salario, forma de trabajo, sitio,
producto, tamaño de empresa) las rellena el modelo de lo que ya dijiste y solo
en los huecos — lo que tú escribas manda. La pantalla de listening explica el
trato y pregunta por dónde avisarte.

**El copy de la pantalla de listening es mío, no el acordado.** Lo escribí en
la voz del resto de la app porque el acordado no está en el repo. Si aparece,
se sustituye; la estructura ya está.

**Voz:** el micro graba de verdad y manda el audio a Whisper; lo transcrito
cae en la caja de respuesta para que lo corrijas antes de enviar. En las
pantallas reales se toca para empezar y se toca para parar (mantener pulsado
dos minutos no es razonable); el recorrido de fixture conserva su mímica. Se
corta solo a los 110 s porque el endpoint devuelve 524 pasados ~2 minutos, y
el audio no se guarda en ningún sitio.

## No empezado

Nada de la lista original de User Zero. Lo siguiente de ese lado sale de la
próxima sesión real. Lo de Opportunity Zero está arriba.
