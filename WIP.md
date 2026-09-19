# Dónde nos quedamos — 19 septiembre 2026

Todo commiteado, de `5695d19` en adelante. Árbol limpio; `tsc`, `eslint`,
`next build` y `npm test` en verde. Bórrame cuando esto esté cerrado.

## Opportunity Zero — entero, y corrido una vez de verdad

La pregunta: **¿sabe Amble cuándo una oportunidad merece interrumpirte?**

No es sourcing, no es el producto para empresas, no es un tablón de ofertas.
Es el primer experimento de match e interrupción, y no tapa el agujero de
abajo (sigue sin llegar nada): responde a la otra mitad, si sabríamos qué
hacer con una oferta el día que llegue.

Estado: `tsc`, `eslint`, `next build` y `npm test` en verde, y las diez
fixtures pasadas contra deepseek. Cero ruido, cero fallos, cero afirmaciones
sin respaldo — y **cero interrupciones**, incluida la que estaba escrita para
tener que salir. Los números y qué hacer con eso, más abajo.

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
- **La pantalla del laboratorio** en `/dev/opportunity-zero`, que era lo único
  que le faltaba al componente para dejar de ser huérfano.
- **La interrupción en listening.** `GET /api/opportunities/interruption`
  devuelve una o `null`; la pantalla la pide cada seis segundos y también se
  renderiza en el servidor, para que quien abra la app desde un aviso caiga en
  la cosa y no en seis segundos de "nothing worth bothering you with". HOLD e
  IGNORE no llegan: el silencio es la respuesta normal.
- **El arnés**, `scripts/measure-opportunities.mjs` y `npm run
  measure:opportunities`: mete las diez por HTTP, espera la cola, y saca la
  matriz, el caso por caso y las latencias por tarea.
- **41 tests** con `node --test`, cero dependencias nuevas.
  `scripts/test-resolve.mjs` es el hook que resuelve `@/` y los imports sin
  extensión; Node 22 quita los tipos él solo. Los de dominio corren sin base
  ni provider; los del pipeline montan una base de usar y tirar en un
  directorio temporal y sustituyen las cuatro llamadas al modelo.

  La promesa de la etiqueta ciega ya no se afirma, se comprueba: la etiqueta
  lleva un token que no aparece en ningún otro sitio y el test construye los
  cuatro prompts que el pipeline mandaría y lo busca en todos.

### La primera pasada real — 19 de septiembre

Diez fixtures, 32 llamadas al modelo, 643 s de reloj. Transcripción entera en
`.amble-data/measure-opportunities.json`.

| | INTERRUPT | HOLD | IGNORE |
| --- | --- | --- | --- |
| **YES** (1) | 0 | 1 | 0 |
| **MAYBE** (3) | 0 | 3 | 0 |
| **NO** (6) | 0 | 1 | 5 |

| | |
| --- | --- |
| Ruido (NO × INTERRUPT) | 0 |
| Fallos (YES × IGNORE) | 0 |
| Afirmaciones sin respaldo | 0 |
| Holds sin nada que preguntar | 0 |
| Las reglas movieron al modelo | 1 de 10 |

| tarea | llamadas | fallos | media | peor |
| --- | --- | --- | --- | --- |
| `opportunity_rubric` | 11 | 1 | 9,4 s | 19,4 s |
| `opportunity_match` | 11 | 1 | 43,7 s | 68,7 s |
| `opportunity_decision` | 10 | 0 | 5,1 s | 10,0 s |

Los dos fallos se reintentaron solos y la tanda no se enteró.
`opportunity_explanation` no sale en la tabla porque no llegó a correr ni una
vez.

**Lo que salió bien.** Los cinco NO que se cayeron se cayeron citando la
razón, y la razón es la del candidato, no una intuición: *"tops out at 85.000
EUR"*, *"es una agencia, y el candidato puso agencias entre lo que no
quiere"*, *"cuatro días en Berlín, y remoto desde Valencia no era
negociable"*. La enfermera salió por tres constraints a la vez. Nada de esto
necesitó un modelo mejor: son las preferencias comprobadas contra la rúbrica.

**Lo que no.** **Cero interrupciones, incluida `opp-strong-ai-infra`**, que se
escribió con "si Amble no me enseña ésta, no funciona". Y no la tumbaron las
reglas: el modelo mismo propuso HOLD. Las cuatro lecturas son buenas — seis
aspectos de intent ALIGNED, "can write" SUPPORTED con ocho evidencias — y aun
así se paró en que el anuncio no dice qué parte del roadmap es paid
acquisition.

### La única decisión abierta

Un `UnknownItem` con materialidad HIGH veta una interrupción, venga de donde
venga. Con eso INTERRUPT es casi inalcanzable: **siempre** falta algo
material, porque el modelo genera desconocidos sin techo y se le da bien.

De los tres que bloquearon la buena, uno es sobre la empresa (el mix de
canales, legítimo) y otro es sobre *él*: "no sabemos si ha hecho crecer una
audiencia de desarrolladores concretamente". Ese es raro de leer: no te
contamos de un trabajo porque no estamos seguros de ti. Es justo lo que se
resuelve con una frase suya, y es para lo que existe la entrevista.

Tres formas de arreglarlo, sin preferencia mía:

1. **Que solo bloqueen los desconocidos del lado `opportunity`.** Los del lado
   `candidate` se van a la entrevista, o al bloque "lo que no sé todavía" de
   la interrupción, que ya existe y ya se muestra.
2. **Que solo bloquee un desconocido atado a un requisito REQUIRED o HIGH.**
   Ahora mismo cualquier hueco HIGH suelto vale.
3. **Dejarlo.** Y asumir que INTERRUPT se reserva a anuncios que no se callan
   nada — pero entonces decirlo así en el copy, porque el producto promete un
   mensaje y lo que da es silencio.

Sea cual sea, el arnés ya está: se cambia la regla, se corre
`npm run measure:opportunities` y se compara contra esta tabla. Los tests de
`settleDecision` cubren el comportamiento de hoy, así que romperlos será
deliberado.

### Sobre `.amble-data/`

El Intent Profile estaba contaminado ("Would consider 50k", suelo de 72k, que
salió de una llamada suelta a la API) y las fixtures están escritas contra
otra cosa. Antes de medir se reescribió **solo el intent y las preferencias**,
por las rutas de verdad (`/api/intent` y confirmar, `PUT /api/preferences`):
AI infra y developer tools, seed o Series A, remoto desde Valencia
innegociable, 120k de suelo, equity, y no a agencias ni a performance puro. El
grafo no se tocó: son las mismas 70 evidencias y 16 capacidades del CV.

En la base hay ahora diez oportunidades con `provenance = fixture`. Quitarlas
es borrar `.amble-data/`, que se lleva el grafo por delante.

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

Antes de esa sesión: borrar `.amble-data/`. El intent ya está limpio (arriba),
pero la base sigue teniendo dentro las diez fixtures de Opportunity Zero.

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
npm test                      # 41 tests, sin red y sin base real
npm run dev                   # http://localhost:3000
npm run check:model           # comprueba el modelo en 2 llamadas cortas
npm run measure -- <cv.pdf>   # sesión entera por API, cronometrada
npm run measure:opportunities # las diez fixtures, con el dev levantado
```

- Traza completa del grafo: http://localhost:3000/dev/user-zero
- Laboratorio de oportunidades: http://localhost:3000/dev/opportunity-zero
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
