# Dónde nos quedamos — 19 septiembre 2026

Todo commiteado, de `5695d19` en adelante. Árbol limpio; `tsc`, `eslint`,
`next build` y `npm test` (106) en verde. Bórrame cuando esto esté cerrado.

## Si solo lees una cosa

El lado del candidato **funciona de punta a punta**: un CV se convierte en
grafo, las ofertas entran solas de tres fuentes, la criba gratis tira lo que
no cumple sin gastar nada, las reglas deciden, la interrupción sale por correo
y —desde hoy— el Rep pregunta cuando le falta algo, la respuesta entra al
grafo y la oferta se vuelve a decidir.

El lado de la empresa **no existe**, y ahí es donde va esto: dos agentes que
averiguan lo que necesitan el uno del otro antes de molestar a nadie. Las
cinco decisiones que hacían falta para empezar están cerradas (§ más abajo).

**Lo siguiente, por orden:**

1. Telegram de entrada — media sesión, y cierra el bucle sin salir del sofá.
2. El lado de la empresa: empresa, apertura, su agente, y la conversación como
   objeto con turnos y traza.
3. La sesión real de Borja con User Zero, que sigue pendiente desde el 18.

**Lo suyo, cuando quiera:** el token de @BotFather, confirmar que el suelo de
120k y el resto del Intent son los buenos (los escribí yo desde las fixtures),
y contestar la pregunta de Ridgeline que quedó abierta.

**Ojo al retomar:** el dev server quedó parado a propósito. Al levantarlo, la
sincronización de fuentes se reprograma sola y puede traer ofertas nuevas y
gastar llamadas al modelo — `AMBLE_SOURCE_SYNC_HOURS=6` en `.env.local`.

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

### El bucle: una pregunta que sale, vuelve y cambia la respuesta

Esto es el paso uno hacia dos agentes hablando, y se construyó primero a
propósito: **es la misma forma con un humano en el otro extremo**. Una
pregunta sale, una respuesta vuelve, el grafo cambia y se decide otra vez.
Poner un agente donde ahora hay una persona es cambiar el destinatario, no
reescribir el sistema.

- **`settleNextAction` prefiere la pregunta que Amble puede hacer.** Antes,
  seis de seis holds preguntaban a la empresa — alguien a quien no puede
  llegar — y el hold no podía moverse nunca.
- **`opportunity_questions`**, tabla propia. No es un turno de entrevista: la
  entrevista es un flujo con principio y final, y esto es una cosa sobre una
  oferta, quizá meses después y sin nada más pasando. Índice único por
  (oportunidad, pregunta): una reevaluación no vuelve a preguntar lo mismo.
- **La respuesta entra por el mismo camino que la de la entrevista.**
  `incorporateAnswer` se generalizó a un `AnswerSource`, así que la evidencia
  lleva procedencia y sale en el Mapa igual que todo lo demás. Lo que alguien
  le cuenta a su Rep es algo que su Rep sabe, venga por donde venga.
- **Se guarda antes de nada.** Leerla al grafo tarda cuarenta segundos y una
  llamada al modelo; perder lo que alguien escribió porque eso falle después
  sería imperdonable.
- **`reassess`**: se vuelve a leer a la persona sin volver a leer el anuncio.
  El puesto no ha cambiado, él sí, y pagar la rúbrica dos veces es pagar por
  leer el mismo documento dos veces.
- **La pantalla y el aviso**: la pregunta va por el mismo outbox que la
  interrupción, con el mismo reintento, y aparece en listening con mucho menos
  peso que una interrupción — es una pregunta, no una decisión.

**Y una corrección que solo salió al medir.** La primera versión prefería
*cualquier* pregunta al candidato, así que a una oferta que sencillamente no
decía lo que paga le preguntaba por audiencias de desarrolladores: algo que
nadie estaba esperando y que además él no puede contestar. Ahora se le
pregunta cuando el hueco sobre él es lo que sostiene la decisión, o cuando no
falta nada que él pusiera como condición. Medido después: las de sueldo
vuelven a preguntar a la empresa, y tres holds preguntan a la persona.

**Ojo con la variabilidad.** `gap-scope-ambiguous` ha salido IGNORE en una
tanda e INTERRUPT en las dos siguientes, con el mismo texto. Es el modelo a
temperatura 0,2 en la etapa de match, no un cambio nuestro. Si se quiere
comparar tandas en serio, hay que contar con eso.

### Sobre leer la base con `readOnly`

Perdí un rato diagnosticando un fallo que no existía: `new DatabaseSync(path,
{ readOnly: true })` desde otro proceso devolvía una foto vieja mientras el
dev server escribía en el WAL. Decía cero preguntas cuando había seis. Para
mirar la base mientras la app corre, conexión normal.

### Y corrió con respuestas suyas de verdad — 19 de septiembre, 14:44

Tres preguntas contestadas por Borja en la pantalla. Lo que pasó:

- **14 evidencias nuevas**, todas `USER_CLAIM`, que es lo correcto: lo ha dicho
  él y nadie lo ha corroborado. Tres incertidumbres del grafo, resueltas.
- Y lo que contestó **no estaba en el CV**: una comunidad de más de 120.000
  desarrolladores en Manfred, y que ahora mismo hace marketing de developers
  en Helmcode con una plataforma de inferencia. El grafo no lo sabía porque el
  CV no lo dice. Exactamente el hueco que el sistema había señalado.

**Ninguna decisión cambió a INTERRUPT, y está bien que no cambiara.** Es lo
que enseña la tanda:

| oferta | antes | después | qué la bloquea ahora |
| --- | --- | --- | --- |
| Palomar | HOLD, preguntándole a él | HOLD | `unk_work_model` → **ASK_COMPANY**: ¿se puede en remoto desde Valencia? |
| Corbel | HOLD, preguntándole a él | HOLD | `unk_company_stage` → **RESEARCH**: ¿en qué etapa está? |
| Ridgeline | HOLD, preguntándole a él | HOLD | ninguno determinista → **ASK_CANDIDATE**, segunda pregunta |

Dos de tres **se movieron de él a la empresa**: sus respuestas cerraron el
lado del candidato y lo que queda no es suyo. La tercera siguió la
conversación con una segunda pregunta, que salió por correo sola.

O sea que el bucle hace lo que tiene que hacer, y al hacerlo deja el
argumento del lado de la empresa sobre la mesa: **Amble está haciendo
preguntas que nadie puede contestar, y las está haciendo a quien toca.** Solo
que al otro lado no hay nadie.

**Una pega de calidad, no de mecánica.** El extractor parte una frase suya en
claims finísimas: "Personally produced content", "Personally produced video
product", "Personally wrote articles", "Personally handled mailing" — cuatro
evidencias donde hay una idea. Es el mismo `extract_answer_claims` que usa la
entrevista, y User Zero está congelado, así que no lo he tocado. Pero
evidencia fina es evidencia débil, y se nota al citarla.

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

**Y sale de verdad.** Resend por SMTP, sin tocar código: `smtp.resend.com`,
usuario `resend`, la API key de contraseña. Cinco interrupciones entregadas el
19 a las 13:00.

Tres cosas salieron de montarlo, y las tres son estados que solo aparecen
cuando lo enchufas:

- **Medio configurado.** Host y usuario pegados de la página del proveedor y
  la key todavía en el portapapeles. Eso contaba como configurado, así que
  cada aviso se encolaba, fallaba la autenticación y reintentaba diez minutos
  dejando el outbox en `failed` — que se lee como "lo rechazaron", no como
  "nunca llegó a estar montado". Ahora un usuario sin contraseña cuenta como
  sin configurar y el motivo dice qué línea falta.
- **Lo escrito antes de que hubiera dónde mandarlo.** Las cinco
  interrupciones existían desde antes que el servidor de correo, en
  `unconfigured`, y nada las devolvía a la cola: configurarlo solo habría
  servido para la siguiente oportunidad. `resumeUnsentNotices` las recupera, y
  coge la dirección de las preferencias de ahora, no de cuando se escribieron.
- **Un 550 no es un corte de red.** Resend rechazó las primeras con *"you can
  only send testing emails to your own email address"*, y la cola lo
  reintentó como si fuera un fallo de transporte. Ahora un 5xx de SMTP (y un
  400/403/404 de Telegram) se marca y se para: cuatro intentos más solo
  entierran el motivo que alguien tiene que leer.

Pendiente tuyo: **verificar un dominio en Resend**. Sin eso solo envía desde
`onboarding@resend.dev` y solo a la dirección de la cuenta, que es la razón
por la que el aviso apunta ahora a `borjaperezfrances@gmail.com` en vez de a
`bperez@helmcode.com`.

Telegram está escrito y probado pero aparcado: falta el token de @BotFather.
WhatsApp sigue sin adaptador y la pantalla lo dice.

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

### Decidido el 19 sobre los dos agentes, no volver a abrirlo

La dirección, en las palabras del propio spec (§1): **intent ↔ evidence ↔
intent**, hasta llegar a Qualified Mutual Intent. Un agente por la empresa y
su oferta, el Rep por la persona, y que sean ellos los que averigüen lo que
necesitan el uno del otro antes de molestar a nadie.

**La regla que lo hace valer algo: los agentes preguntan y responden, no
deciden.** Las preguntas salen de los huecos que identificaron las reglas,
las respuestas tienen que poder citarse, y la decisión la siguen tomando las
reglas de cada lado por separado. Dos LLMs sueltos convergen en estar de
acuerdo — ya lo medimos aquí: el modelo holdeaba todo hasta que las reglas y
el prompt le pusieron la barra.

1. **La escalera de divulgación.** Antes de que él diga nada, su Rep solo
   responde y nunca ofrece: confirma o niega lo que la rúbrica pregunta, con
   la evidencia detrás. Sus números no salen — a "¿cuál es su mínimo?" se
   responde *"lo supera"*, nunca 120.000. Sin nombre, sin empresa actual, sin
   ciudad. Cuando él dice adelante: nombre, historial y el Mapa. Nunca sin
   pedirlo él: sus "no" tal cual los escribió, sus dudas sobre el empleo
   actual, y las respuestas de la entrevista en bruto.
2. **A un humano no se le molesta** hasta que la conversación esté terminada
   o atascada en algo que solo esa persona puede contestar.
3. **"Acordado" =** los hard constraints de los dos lados pasan y a ninguno le
   queda un desconocido bloqueante. Es `decisionSignals` corrido dos veces,
   una con las reglas de cada parte. Ningún agente declara el acuerdo.
4. **El candidato no paga nada, nunca.** La empresa paga un precio del que
   sale el coste; no hay factura por búsqueda. Consecuencia de ingeniería, no
   de negocio: la criba gratis deja de ser un ahorro y pasa a ser la condición
   de que los números salgan — una oferta contra doscientos Reps son
   seiscientas llamadas al modelo si no se filtra antes con lo comprobable. El
   techo por tanda (`maxEvaluations`) se queda, como control de coste.
5. **No se rankea.** El §27 dice "Amble represents people. It doesn't rank
   them". El agente de la empresa devuelve *"tres Reps quieren hablar"*, no
   una lista ordenada con puntuaciones. Si algún día se quiere el orden, es
   una decisión de producto grande y se discute entera.

**Telegram antes que el correo entrante.** Contestar por correo exige o un
túnel permanente (Resend Inbound es por webhook, tiene que llegar a la
máquina) o parsear respuestas con texto citado y firmas. `getUpdates` de
Telegram es sondeo desde nuestra máquina hacia fuera: ni URL pública, ni
túnel, ni parseo. Es el único canal de dos direcciones que funciona con esto
corriendo en un portátil.

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
