# Dónde nos quedamos — 19 septiembre 2026

Todo commiteado, de `5695d19` en adelante. Árbol limpio; `tsc`, `eslint`,
`next build` y `npm test` en verde. Bórrame cuando esto esté cerrado.

## Opportunity Zero — entero, y ya interrumpe

La pregunta: **¿sabe Amble cuándo una oportunidad merece interrumpirte?**

No es sourcing, no es el producto para empresas, no es un tablón de ofertas.
Es el primer experimento de match e interrupción: si sabríamos qué hacer con
una oferta el día que llegue. Desde hoy además llega alguna sola, que era la
otra mitad del agujero.

Estado: `tsc`, `eslint`, `next build` y `npm test` (70) en verde. Las diez
fixtures corridas tres veces contra deepseek: cero ruido, cero fallos, cero
afirmaciones sin respaldo, los seis NO fuera, y la que estaba escrita para
tener que salir sale. Las ofertas entran solas desde Manfred y el aviso sale
por correo. Los números, abajo.

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
- **Una fuente de ofertas** (`src/lib/sources/manfred.ts` + `manfred-sync.ts`),
  con criba gratis antes de gastar nada. Detalle abajo.
- **El outbox y el envío por SMTP** (`src/lib/notify/smtp.ts`,
  `src/lib/pipeline/notify.ts`), sin dependencias nuevas. Detalle abajo.
- **`npm run reset:opportunities`**, para volver a medir sin borrar el grafo.

### Tres pasadas, y la tercera interrumpe

Las diez fixtures, corridas enteras contra deepseek tres veces el 19. La
transcripción de la última está en `.amble-data/measure-opportunities.json`.

| | INTERRUPT | HOLD | IGNORE |
| --- | --- | --- | --- |
| **YES** (1) | **1** | 0 | 0 |
| **MAYBE** (3) | 1 | 2 | 0 |
| **NO** (6) | 0 | 0 | 6 |

| | 1ª | 2ª | 3ª |
| --- | --- | --- | --- |
| Ruido (NO × INTERRUPT) | 0 | 0 | 0 |
| Fallos (YES × IGNORE) | 0 | 0 | 0 |
| NO que caen en IGNORE | 5 de 6 | 6 de 6 | 6 de 6 |
| Interrupciones | 0 | 0 | **2** |
| Afirmaciones sin respaldo | 0 | 0 | 0 |
| Holds sin nada que preguntar | 0 | 0 | 0 |

Latencias de la tercera: rúbrica 12,2 s de media, match 33,2 s, decisión
4,5 s, explicación 9,4 s. Un fallo de red en once llamadas, recuperado solo.

**Qué cambió entre la una y la otra.** Dos cosas, y las dos son la misma:
el modelo y las reglas no estaban usando la misma definición de "material".

1. **Solo bloquea un hueco en algo que la persona puso como condición.**
   `UnknownItem` lleva ahora `deterministic`, igual que los hard constraints:
   lo pone el código cuando el hueco cae sobre el sueldo, la presencia, el
   sitio o la etapa — cosas que él nombró. Lo que el modelo *nota* que falta
   sigue existiendo, sigue contándose y sale en la interrupción dentro de "lo
   que no sé todavía"; simplemente ya no compra silencio. Efecto inmediato:
   `opp-vp-engineering` dejó de ser HOLD y pasó a IGNORE, que es su etiqueta.
2. **El prompt de decisión dice lo mismo** (`DECISION_VERSION` v2). Antes
   leía "material missing information normally means HOLD" y el modelo, que
   encuentra diez huecos en cualquier anuncio, holdeaba siempre. Ahora
   distingue los dos tipos de hueco y dice en voz alta que la evidencia aquí
   está graduada con honestidad: PARTIALLY_SUPPORTED es el aspecto normal de
   un buen match, y SUPPORTED en todo no es la barra ni pasa nunca.

Con eso, `opp-strong-ai-infra` —la que se escribió con "si Amble no me enseña
ésta, no funciona"— sale por fin. Y sale citando: cuatro evidencias del CV
detrás de cada frase, los tres huecos que antes la tumbaban ahora abajo, como
preguntas abiertas. Es exactamente la pantalla que el spec pedía en §17.

**Lo que hay que vigilar.** `opp-series-a-unclear-scope` también interrumpe, y
su etiqueta era MAYBE ("partner closely with the CRO suele querer decir que el
CRO manda"). No es ninguno de los dos errores que cuentan, pero es el borde:
si en la próxima tanda aparecen más MAYBE arriba, la barra se ha aflojado
demasiado. La medida está para eso.

### El conjunto de huecos — ocho que encajan, cada una rota por un sitio

`npm run measure:gaps`. Ocho ofertas que **todas** deberían interesarle:
growth o marketing, AI infra o developer tools, early stage, remoto, por
encima del suelo, con equity, ninguna agencia ni performance. Lo que se mide
aquí no es si distingue un casi-match — eso es el otro conjunto — sino si,
cuando falta algo, **pregunta lo que hay que preguntar**.

| | INTERRUPT | HOLD | IGNORE |
| --- | --- | --- | --- |
| **YES** (1) | 1 | 0 | 0 |
| **MAYBE** (7) | 0 | 5 | 2 |

Los cinco HOLD preguntaron, y preguntaron bien:

- sin sueldo → *"What is the base salary range for this Head of Growth role,
  and can you employ someone based in Valencia?"*
- sin modelo de trabajo → *"…could someone perform it fully remotely from
  Valencia without relocating or attending a weekly office?"*
- "competitive" → *"What is the base salary range and currency?"*
- en dólares → *"Is the 145,000-165,000 denominated in USD or EUR, and is that
  base before bonus?"*
- sin etapa → RESEARCH: *"What stage is Corbel at, how much has it raised, and
  how many people are on the team today?"*

Cero holds sin pregunta, cero afirmaciones sin respaldo.

**Los dos MAYBE que salieron IGNORE son la discusión.** Ninguno es de los dos
errores que cuentan, pero en los dos habría sido mejor preguntar que callar:

- `gap-contradictory-location` dice "FULLY REMOTE" arriba y "cuatro días en la
  oficina de Madrid" abajo. La rúbrica lo resolvió en silencio por lo estricto
  (híbrido) y se cayó por constraint. Protege, sí — pero una contradicción no
  es un dato, es una pregunta.
- `gap-scope-ambiguous` se titula Head of Growth y describe a un jefe de SDRs.
  El modelo propuso HOLD y **las reglas lo bajaron a IGNORE**, porque el
  propio modelo había propuesto un hard constraint trazable ("reporta al CEO y
  manda en todo") que fallaba. Defendible, y aun así: preguntar de qué puesto
  hablamos habría costado una frase.

**Y lo más importante que enseña este conjunto: cero `ASK_CANDIDATE`.** Las
cinco preguntas van a la empresa o a una búsqueda — a alguien con quien Amble
no puede hablar. La única pregunta que Amble *sí* puede hacer, a él, no se usó
ni una vez, ni siquiera en `gap-about-the-candidate`, que está escrita para
provocarla (el anuncio no calla nada; lo que falta es saber si él ha llevado
una comunidad). Ahí salió INTERRUPT, con la duda abajo, en "lo que no sé
todavía" — que es coherente con su etiqueta YES, pero no es el bucle.

Cerrar ese bucle —preguntar, incorporar la respuesta al grafo, volver a
evaluar— es lo siguiente de Opportunity Zero, y la maquinaria ya existe: es la
entrevista. Falta unir `ASK_CANDIDATE` con una `uncertainty` y volver a correr
la oportunidad cuando se resuelva.

**De regalo, una prueba que no buscaba:** a mitad de la tanda se cayó el DNS.
26 de 34 llamadas a la rúbrica fallaron con ENOTFOUND, la cola reintentó con
su backoff y terminó las ocho sola. Nadie tocó nada.

### Un HOLD también necesita evidencia

La regla que salió de las ofertas reales, ya aplicada: si los requisitos
materiales del puesto se evaluaron y **ninguno** está soportado por evidencia
citable, un HOLD propuesto baja a IGNORE. Esperar no convierte a un marketero
en backend, y ninguna respuesta de la empresa lo cambia.

Con cuidado de no romper lo otro: si el anuncio no dice qué pide (el caso de
`opp-thin-posting`), los requisitos no se han evaluado y el hold se queda,
porque ahí el hueco sí es de la empresa. La tanda de calibración salió
idéntica a la anterior, que era la comprobación.

### Mirar solo, sin cron

`AMBLE_MANFRED_SYNC_HOURS=6` y va sola. No hay demonio: la cola ya sabe correr
algo más tarde y sobrevivir a un reinicio, así que la sincronización pone la
siguiente en la cola antes de terminar — en un `finally`, porque una
sincronización que falla y no reprograma deja de escuchar para siempre y en
silencio, que es el único fallo que este producto no puede tener. Y los dos
endpoints que las pantallas ya sondean la vuelven a poner si desapareciera.

Corre mientras corra el servidor, que para algo que se usa desde el móvil es
lo mismo.

Eso destapó un fallo que llevaba ahí desde el principio: `queueStatus.busy`
contaba como "ocupado" un trabajo programado dentro de cinco horas, así que
el laboratorio se habría puesto a sondear cada dos segundos toda la tarde.
Ahora solo cuenta lo que corre o vence en el próximo minuto.

### Las ofertas ya llegan solas

**Manfred sí tiene API pública**, y es la que usa su propia página:

```
GET /api/v2/public/offers?onlyActive=true&lang=ES   todas las vivas (17 hoy)
GET /api/v2/public/offers?lang=ES                   las 1.651 con histórico
GET /api/v2/public/offers/{id}?lang=ES              una, entera
```

(Me equivoqué la primera vez: probé `/api/v2/public/offers` en
`api.getmanfred.com`, que lleva `/api` de más y da 404, y me quedé con
`offer-filter`, que pide token y en realidad es para las alertas guardadas de
un usuario. El endpoint bueno está en el chunk perezoso del listado.)

Sin llave y sin nada privado. Y la forma de esa primera llamada manda sobre
todo lo demás: **una** petición devuelve todas las ofertas vivas con lo que
pagan, cuánto es presencial y dónde — justo lo que el dominio puede
comprobar gratis.

- `src/lib/sources/manfred.ts` habla con la API. El parseo es puro y está
  probado contra las rarezas que importan: `equityInf: 0` es "no hay equity",
  no "cero por ciento"; `remotePercentage` es un porcentaje y no un modo; la
  moneda es un glifo; y `techs` viene ya graduado en MUST/SHOULD/COULD, que
  es lo más parecido a una rúbrica que tiene la fuente, así que se conserva.
- `src/lib/pipeline/manfred-sync.ts` sincroniza sobre la cola.
- **La criba gratis, primero, y sobre el listado.** Con los números que da la
  lista se corre el mismo `deterministicHardConstraints` que usa el pipeline
  después. Lo que no pasa se guarda con el motivo y **no se llega ni a
  descargar**. Solo lo que sobrevive se pide entero, de una en una y con
  pausa, y una oferta ya guardada no se vuelve a pedir (`source_ref` único).
- `POST /api/sources/manfred` y un botón en el laboratorio. `maxEvaluations`
  limita cuántas supervivientes se evalúan por tanda.

Probado de verdad: 17 vivas, **13 descartadas sin descargar nada** ("At least
120.000 EUR. The posting tops out at 45.000 EUR. Works remote. The role is
hybrid"), 4 bajadas enteras (11-14 mil caracteres de anuncio bien
estructurado, contra los blobs que salían del HTML).

**La siguiente decisión de calibración, y ya hay caso.** Con ofertas reales,
HOLD se convierte en el cajón de "no es para ti pero es remoto y paga bien":
un Senior Backend Engineer salió HOLD con el motivo del propio modelo — *"the
candidate's record is entirely marketing, growth and design"*. Eso no es
esperar información, es que no sabe hacer el trabajo, y ninguna respuesta de
la empresa lo cambia.

Lo permite `positiveSignal` en `decisionSignals`: basta con que *algo* apunte
en la buena dirección, y la alineación de intención sola (remoto, paga bien,
seed) ya cuenta. La regla simétrica de la de INTERRUPT sería: **un HOLD
también necesita algo del lado de la evidencia**. Si ningún requisito
material está ni parcialmente soportado por evidencia citable, y no falta
nada que él pusiera como condición, es IGNORE.

No lo he tocado: es un cambio de regla y merece su propia medición, y las
diez fixtures no cubren este caso (todas son de su oficio). No cuesta nada
mientras tanto — HOLD no llega al candidato.

### Tres fuentes, una interfaz

`FeedAdapter` en `src/lib/sources/types.ts`: `list()` y `rawText(offer)`, y el
resto del pipeline no sabe de dónde vino nada. Manfred, Greenhouse y Ashby lo
implementan, y `syncSource` es el mismo código para las tres.

**Los ATS son los tableros donde las startups publican de verdad.** Casi nadie
pone ofertas en su web: las pone en su ATS y empotra el tablón, y ese tablón
sirve el mismo JSON en abierto porque así funciona el empotrado.

```
GET boards-api.greenhouse.io/v1/boards/{empresa}/jobs?content=true
GET api.ashbyhq.com/posting-api/job-board/{empresa}?includeCompensation=true
```

Una petición por empresa, con el anuncio entero dentro: cero segundas vueltas.

Y son honestamente peores que Manfred en lo que importa para la criba: **ni
uno da salario de forma fiable**, y Greenhouse da la ubicación como texto
libre ("Hybrid - London"). La tentación es leer eso como híbrido y llamarlo un
hecho. No lo es, y suspender a alguien por un constraint que nadie declaró
sería justo el error que las reglas están escritas para no cometer. El
adaptador deja esos campos en null, el screen los deja en UNKNOWN y el anuncio
lo lee el modelo.

Así que la criba ahí es otra: `AMBLE_ATS_DEPARTMENTS` contra el departamento
que da el propio tablón — dato de la fuente, no adivinanza nuestra sobre el
título. Probado: Vercel 84 → 10, PostHog 9 → 1, y las once son de marketing o
growth.

**Un fallo que salió de probarlo.** La primera versión reprogramaba la
sincronización de ATS sin parar: cada tablón deja su registro con su nombre
(`greenhouse:vercel`), el planificador buscaba uno llamado `ats`, no lo
encontraba, concluía que nunca había corrido y encolaba otra. Un bucle que lee
dos tableros para siempre y que desde fuera parece que la app está ocupada.
Ahora `syncAll` deja también un registro del grupo, que es el que lee el
planificador. Las dos fuentes quedan programadas una sola vez, a seis horas.

### El aviso sale de la máquina

La pantalla prometía "you get one message" y ese mensaje solo existía si
tenías la pestaña abierta. Ahora:

- **Un outbox** (`notifications`), escrito en el momento en que existe la
  decisión, con índice único sobre (sobre qué, por qué canal): un reintento
  tras un corte no manda una segunda copia.
- **Se entrega en la cola**, con el mismo backoff que todo lo que toca una
  red. Un servidor de correo caído a medianoche es el mismo problema que un
  modelo que expira.
- **SMTP a pelo sobre `node:tls`**, sin dependencias: EHLO, STARTTLS, AUTH
  PLAIN o LOGIN, y el cuerpo en base64 para que las líneas largas y los
  puntos dejen de importar. Probado contra un servidor falso que habla el
  protocolo de verdad en un puerto de verdad, incluidas las respuestas
  multilínea y que **la contraseña no acaba nunca en `last_error`**.
- **Dice lo mismo que la pantalla**, palabra por palabra: dos versiones de por
  qué se interrumpe a alguien son dos productos.
- **Sin servidor configurado no se inventa nada**: el mensaje se escribe igual
  y el outbox dice `unconfigured`. El silencio por accidente y el silencio a
  propósito no pueden parecerse.

Falta la parte tuya: `AMBLE_SMTP_HOST` y compañía en `.env.local` (están
documentados en `.env.example`). Ahora mismo hay cuatro filas en el outbox,
dos interrupciones × dos canales, todas `unconfigured`. WhatsApp no tiene
adaptador: se encola, se ve pendiente y no se manda.

### Sobre `.amble-data/`

El Intent Profile estaba contaminado ("Would consider 50k", suelo de 72k, que
salió de una llamada suelta a la API). Antes de medir se reescribió **solo el
intent y las preferencias**, por las rutas de verdad (`/api/intent` y
confirmar, `PUT /api/preferences`): AI infra y developer tools, seed o Series
A, remoto desde Valencia innegociable, 120k de suelo, equity, y no a agencias
ni a performance puro. El grafo no se tocó: las mismas 70 evidencias y 16
capacidades del CV.

Y ya no hay que borrar la carpeta para volver a medir:
`npm run reset:opportunities` se lleva las oportunidades de fixture, sus
lecturas y las llamadas al modelo, y deja el grafo, el intent y las
preferencias donde estaban. `-- --all` se lleva también las de Manfred, que
ahora mismo son 17.

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

El agujero de "no llega nada" está tapado a medias: Manfred entra sola, pero
es una sola fuente, española, y con 17 ofertas vivas — de las que 13 se caen
por el suelo de 120k. El embudo real para este candidato son cuatro ofertas,
y ninguna es de marketing. Hace falta otra fuente antes de que la medición
con ofertas reales diga nada.

Nadie la dispara sola todavía: el botón del laboratorio o la ruta. Un cron es
lo siguiente obvio.

El copy de listening ya está cambiado: decía "Nothing is arriving yet", que
dejó de ser verdad. Ahora dice de dónde vienen y que casi ninguna llegará. No
lleva contador a propósito — "he mirado 1.650 ofertas por ti" es la métrica
de vanidad que el spec prohíbe en §16.

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
npm run reset:opportunities   # quita las fixtures, deja el grafo
```

Para traer ofertas de Manfred: el botón del laboratorio, o

```bash
curl -X POST localhost:3000/api/sources/manfred   -H 'Content-Type: application/json' -d '{"limit":40,"maxEvaluations":10}'
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
