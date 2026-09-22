# Dónde nos quedamos — 22 septiembre 2026

Todo commiteado y empujado, hasta `59f2351`. Árbol limpio; `tsc`, `eslint`
(un warning viejo), `next build` y `npm test` (292) en verde. Desplegado y
comprobado en producción. Bórrame cuando esto esté cerrado.

## Si solo lees una cosa

El lado del candidato **funciona de punta a punta**: un CV se convierte en
grafo, las ofertas entran solas de tres fuentes, la criba gratis tira lo que
no cumple sin gastar nada, las reglas deciden, la interrupción sale por correo
y el Rep pregunta cuando le falta algo, la respuesta entra al grafo y la
oferta se vuelve a decidir. Y —desde hoy— esa respuesta **vuelve por
Telegram**, por escrito o hablando: se contesta al mensaje y ya está, sin
abrir la app. Corriendo de verdad, con bot y chat id configurados.

El lado de la empresa **no existe**, y ahí es donde va esto: dos agentes que
averiguan lo que necesitan el uno del otro antes de molestar a nadie. Las
cinco decisiones que hacían falta para empezar están cerradas (§ más abajo).

Y **deja de vivir en el portátil**: hay Dockerfile, `railway.json` y una
puerta con contraseña delante, porque en una URL pública ahí dentro está su
CV. Con una libreta en `/feedback` para las ideas, que era el motivo de
desplegarlo.

**Lo siguiente, por orden** (lo primero de la lista del 19 ya está hecho):

1. **Que el onboarding pregunte una vez lo que se repite oferta tras oferta**
   (propiedad, escala, presupuesto). Lo cuarto de su lista, y lo más grande:
   toca la entrevista.
2. El lado de la empresa: empresa, apertura, su agente, y la conversación como
   objeto con turnos y traza.
3. La sesión real de Borja con User Zero, que sigue pendiente desde el 18 —
   ahora tiene sitio donde hacerla, que es el móvil.
4. **Lo que se apunte en `/feedback`.** Ese es el punto de la libreta: que la
   lista de arriba la escriba él y no yo.

**Por escrito sigue siendo lo normal.** El audio es una vía más, no la vía: se
contesta escribiendo por Telegram, escribiendo en la pantalla, o hablando.

**Lo suyo, cuando quiera:** verificar un dominio en Resend (sin eso el correo
solo sale a su Gmail), confirmar que el suelo de 120k y el resto del Intent
son los buenos (los escribí yo desde las fixtures), y decir si quiere que
limpie las evidencias duplicadas que dejó el reintento (ver § de las ocho
preguntas).

**Ojo al retomar:**

- El dev server quedó **parado a propósito**. Al levantarlo, la sincronización
  de fuentes se reprograma sola y puede traer ofertas y gastar llamadas al
  modelo: `AMBLE_SOURCE_SYNC_HOURS=6` en `.env.local`. Para probar sin eso,
  `AMBLE_SOURCE_SYNC_HOURS= npm run dev` (vacío en el entorno gana a
  `.env.local`).
- **Telegram está configurado y vivo**: bot `@amble_rep_bot`, chat id
  `5028804103` guardado en preferencias. En cuanto el server arranca, sondea
  cada diez segundos. Cualquier cosa que decida el pipeline le llega al móvil
  de verdad.
- Quedó una oferta a medio evaluar, **Nomad Compute** (`opp_aabc6dc6d6ae4577`),
  metida a mano para ver el idioma de punta a punta. Al levantar el server
  retoma sola. Con las reglas nuevas debería preguntar poco o nada.
- La red hasta `api.telegram.org` desde esta máquina va lenta a ratos y se
  pasa del timeout de conexión de undici (10 s). Se recupera solo; si se
  vuelve costumbre, hace falta un dispatcher propio.
- **Está desplegado y en pie**: https://amble-agent-production.up.railway.app
  — volumen en `/data`, las 26 variables puestas, y el grafo subido (3,4 MB y
  los cuatro ficheros de `uploads/`). La contraseña está en el gestor de
  Borja; si se pierde, se cambia `AMBLE_PASSWORD` en Railway.
- **Dos Reps es el riesgo real ahora.** El token de Telegram está en los dos
  sitios: si se levanta `npm run dev` aquí con el chat id guardado, el
  portátil y Railway sondean el mismo bot y los dos actúan sobre el mismo
  mensaje. Para tocar en local, `AMBLE_TELEGRAM_BOT_TOKEN=` vacío delante del
  `npm run dev`.
- **El servidor ya está limpio**: las ocho fixtures fuera, 30 ofertas de
  fuentes reales dentro. Queda **Nomad Compute** (`manual`), que también era
  una prueba — se borra con `npm run reset:opportunities -- --manual` y otro
  `push:db` si estorba.
- La puerta **no existe sin `AMBLE_PASSWORD`**. En local se sigue entrando
  como siempre, a propósito: una contraseña por cada `npm run dev` es cómo se
  acaba con la contraseña escrita en un post-it.

## 22 de septiembre — su lista, la waitlist, el panel, la voz y GitHub

El día entero fue **su lista de feedback**, escrita por él en `/feedback` desde
el móvil, una por una y por orden. Que la lista la escriba él era justamente el
motivo de desplegar la libreta, así que esto es la libreta funcionando.

**Lo que salió de la lista** (`17a0e71` → `c98fcd2`):

- **Los ids se le estaban colando en su propio Mapa.** Leía `unc_4f2a` en una
  frase escrita para él. `stripIds` vive ahora en `src/domains/ids.ts` con la
  lista de prefijos comprobada contra los que se generan de verdad — la
  anterior cubría `unc_` y se dejaba `unk_`, y un filtro que pilla la mitad es
  peor que ninguno porque parece que funciona. Con él, `standingDescription()`,
  que quita los arranques de delta («Unchanged», «No new evidence») en bucle y
  se queda con lo que va detrás de `Basis remains:`.
- **«Listening for» dejó de preguntarle lo que ya había contestado.**
- **De dónde te conozco, arriba en vez de al final.** Estaba calculado y
  enterrado debajo de dieciséis capacidades, que es como no estar.
- **Una lista de espera** (`3d49757`), que pidió a media lista porque va a
  lanzar la idea: un correo y ya está. `POST /api/waitlist` es público y el
  `GET` sigue detrás de la puerta. La respuesta es la misma la primera vez y
  la quinta, para que nadie pueda usarla para saber quién está apuntado.
- **Un panel de admin** (`773b188`) en `/admin`: la waitlist con los correos
  copiables, la salud del modelo por tarea **y por versión**, el tono, los
  veredictos y las reescrituras, las colas, la conversación, las ideas y el
  parte de excepciones. Y sólo con lo que hay de verdad — ninguna tarjeta
  inventa un número que no se pueda perseguir.
- **«En marcha»** (`c98fcd2`): lo que dijo que sí y qué ha pasado desde
  entonces.

**La voz** (`d32a129`). Pasó el documento de voz y los cinco principios. Tres
cosas mías lo incumplían:

1. **El parte de excepciones le narraba la maquinaria en su pantalla.** Leía
   «4 trabajos se rindieron tras reintentarlo · deliver_notification: No
   answer from smtp.resend.com:587». Ahora cada excepción declara **para
   quién** es (`ExceptionAudience`): la fontanería —cola atascada, trabajo
   rendido, tablón mudo— vive en `/admin`, y en `/listening` sólo queda lo
   suyo, dicho en primera persona.
2. **Fuera la barra de progreso** de `/me`, hecha esa misma mañana. El
   documento usa ese ejemplo exacto: «Tu perfil está completo al 82%» no; «Sé
   lo suficiente para empezar a escuchar» sí. Una barra convierte esto en el
   juego de rellenar perfil de LinkedIn.
3. **Primera persona**: «Tu Rep está escuchando» → «Estoy escuchando».
   «Pensando qué decirte…» era teatro; «Mirando lo que sé de ti…» sí describe
   algo que pasa.

**GitHub, leído de verdad** (`59f2351`). Era una URL guardada con un cartel de
«not supported». Ahora `src/lib/sources/github.ts` lee el perfil, los repos, y
de los que valen la pena los lenguajes por bytes, el README y qué hay en la
raíz — un `docker-compose.yml` o un `terraform/` dicen cómo construye mejor
que una línea de CV. Fuera forks y archivados; orden por estrellas y empates
por último push; seis en profundidad. **Lo que no se pudo leer se cuenta y se
dice** al final del documento. Entra por la misma puerta que un CV, así que
cada claim apunta a un repo que se puede abrir. Probado contra el API real con
su perfil: 4 repos, 2 en profundidad, 0 sin leer, 7.801 caracteres.

Por el camino, **una fuente rota desde que existe**: la web/portfolio
descargaba el texto, lo escribía en disco y guardaba `stored_path: null`, así
que `readSourceContent` devolvía vacío y acababa en `failed` con el contenido
ya bajado. Nunca se ha leído ninguna web. Una línea.

### Lo que queda de su lista

1. **Móvil** (su punto 1). Sigue sin comprobarse en una pantalla de verdad —
   nunca la he visto. Hace falta que mande dos o tres capturas de lo que le
   chirría, o no es una revisión, es adivinar.
2. **El percentil** (su punto 7), **bloqueado en una decisión suya**. Pidió un
   percentil de talento y su pitch de lanzamiento lo menciona, pero el
   documento de voz dice que AMBLE no te dice lo bueno que eres y prohíbe el
   vocabulario de puntuación. Mi recomendación, sin tocar nada: cambiar el eje
   —«de las 40 ofertas que he visto, encajas en 6, y en 3 de las que más
   pagan»— que es el mismo dato útil sin ser una nota. Si el pitch necesita el
   percentil, se hace, pero entonces el documento pierde su punto 10.

### Y tres cosas abiertas que no son de la lista

- **El correo está muerto en Railway.** `deliver_notification` falla con «No
  answer from smtp.resend.com:587»; el puerto 587 parece bloqueado en la
  plataforma. Telegram no se ve afectado y sigue siendo la vía buena. Sin
  arreglar: lo más probable es pasar a la API HTTP de Resend en vez de SMTP.
- **La mezcla de castellano e inglés** entre pantallas, que se nota al pasar
  de una a otra.
- **La animación de 2,6 s a pantalla completa** cada vez que se entra en
  `/listening`. Es exactamente lo contrario de «smooth».

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

Telegram está escrito y probado —ahora también de entrada, § más abajo— pero
aparcado: falta el token de @BotFather. WhatsApp sigue sin adaptador y la
pantalla lo dice.

### Y la respuesta vuelve sola, por Telegram

Hasta hoy todos los bucles acababan en una pantalla. La pregunta salía por
correo diciendo "answer here" y contestar era encontrar la pestaña, que es
justo lo que este producto dice que te ahorra. La interrupción tenía el mismo
problema por el otro lado: el mensaje llega al móvil y el sí vive en el
portátil.

Ahora Telegram es de ida y vuelta. Se contesta al mensaje y esa respuesta
entra al grafo por el mismo camino de siempre, la oferta se vuelve a decidir,
y la app no se abre en ningún momento. **Nada nuevo decide nada**: esto es un
transporte, y le pasa lo que recibe a las dos funciones que ya existían
(`answerQuestion` y `recordCandidateResponse`).

Importa más allá de la comodidad. Al otro extremo de este bucle va a haber
otro agente, no una persona, y una máquina que solo funciona con una pestaña
abierta nunca fue un bucle.

Lo que hubo que decidir, y por qué:

- **El orden de lectura.** Un comando es un comando; lo demás, si hay una
  pregunta abierta, es la respuesta entera y sin parsear. `/yes` y `/no`
  contestan una interrupción **solo como comandos**: con una pregunta abierta,
  "yes, for about two years" es una respuesta, y leer su primera palabra como
  un veredicto sobre otra oferta le cuesta la tarde a alguien. Si no hay nada
  abierto, el mensaje se acusa recibo y no se actúa sobre él.
- **Dos interrupciones esperando = no se adivina.** Un "sí" pelado no dice
  cuál, y apuntar una decisión sobre un puesto en el que no estaba pensando es
  peor que pedirle que mire la pantalla. Lo dice y pone el enlace.
- **Todo mensaje se escribe antes de tocarlo**, incluido el de un
  desconocido. Telegram reenvía un update hasta que un offset lo confirma, así
  que la misma respuesta puede llegar dos veces —un reinicio entre la
  confirmación y el envío— y **dos veces sería dos evidencias de una sola
  frase**. El índice único sobre (canal, update id) es donde se promete eso, no
  en el bucle que toque sondear.
- **Solo el chat configurado.** El usuario de un bot es público y cualquiera
  puede escribirle. A un desconocido no se le contesta: explicarle qué es esto
  sería una conversación, y aquí no hay nadie para tenerla.
- **No se sondea hasta que hay chat id.** No es solo higiene: preguntar con
  offset le dice a Telegram que puede olvidar esos updates, y el chat id se
  averigua justamente leyéndolos con `npm run telegram:whoami`. Un poller
  arrancado antes se comería el mensaje del que depende el alta.
- **Carril propio en la cola.** Detrás de una evaluación serían sesenta
  segundos entre que contesta y Amble se entera; en el carril interactivo se
  pondría por delante de la pregunta que está mirando, cada diez segundos. Y
  queda fuera de `queueStatus`: un trabajo que vuelve a tocar cada diez
  segundos para siempre haría que todas las pantallas dijeran "trabajando" todo
  el día, cuando lo que está haciendo es escuchar.
- **El cuerpo del mensaje cambia en una línea, y solo en una.** Por correo
  sigue diciendo "Answer here: …"; por Telegram, "contesta a este mensaje" o
  "/yes y /no". Lo de arriba —el porqué, la evidencia, lo que no se sabe— es
  idéntico en los dos, que era la regla.

### Y corrió de verdad — 19 de septiembre, 18:30

Token puesto (@amble_rep_bot), chat id guardado por la ruta de siempre, y el
bucle entero cerrado desde el móvil: contestó por Telegram, entraron **siete
evidencias nuevas** al grafo, Ridgeline se volvió a decidir y **salió una
pregunta nueva** —la de si ha gestionado presupuesto— que llegó al mismo chat.
Eso es la ida y la vuelta funcionando sin abrir la app.

Y enseñó dos fallos que ninguna prueba con API falsa iba a enseñar, los dos de
la misma familia: **cuatro mensajes en vuelo a la vez**.

- **Se reenviaron preguntas ya contestadas.** Al guardar el chat id,
  `resumeUnsentNotices` sacó las cinco notificaciones que estaban esperando
  desde antes de que hubiera bot — y tres eran preguntas que él ya había
  contestado en la pantalla horas antes. Las contestó otra vez, con cuidado, y
  el Rep le dijo que no había nada abierto. Ahora una notificación sin enviar
  se comprueba antes de salir y, si lo que preguntaba ya está resuelto, pasa a
  `obsolete` con el motivo. Sigue sin borrarse: "no te avisé" necesita
  respuesta, y "me avisaste de algo que ya había hecho" también.
- **No se sabía a qué mensaje contestaba.** La respuesta se aplicaba a la
  pregunta abierta más antigua, así que con cuatro en vuelo tres habrían
  acabado en el sitio equivocado. Telegram manda `reply_to_message` gratis
  cuando usas su botón de responder: ahora el outbox guarda el `message_id` de
  lo que envió (`notifications.external_id`) y la respuesta se encamina por
  ahí. Si citan una pregunta ya cerrada se lo dice, nombrándola, en vez de
  tragarse la respuesta. Y cuando no citan nada y hay más de una abierta,
  contesta la más antigua **y avisa de que ha tenido que elegir**.

De paso, el acuse de recibo ahora dice cuál: "Thank you. Noted — Head of
Growth at Ridgeline AI". En una pantalla solo hay una pregunta delante; en un
chat puede haber cuatro de hace horas.

**Ojo con la red.** Conectar con `api.telegram.org` desde aquí tarda a veces
cinco segundos y alguna vez se pasa del timeout de conexión de undici (10 s,
que no es el nuestro de 15 s). Un aviso tardó cinco intentos en salir. La cola
lo reintenta y el sondeo vuelve en diez segundos, así que se recupera solo,
pero si se vuelve costumbre habrá que subir el timeout de conexión con un
dispatcher propio.

Trece casos en `inbound-telegram.test.ts` y uno en `opportunities.test.ts`: la
respuesta que entra, el update repetido, el chat ajeno, el `/start`, el `/no`
contra la única interrupción, que sin chat id no se llama a Telegram, la
respuesta citada que va a su pregunta y no a la más vieja, la pregunta ya
cerrada, el aviso de que ha elegido, y la notificación que se queda
`obsolete`.

### El Rep habla castellano, y se puede elegir

El idioma vive en las preferencias (`language`, `es` por defecto) con un
interruptor en la pantalla de escucha, y todo el texto sale de un diccionario
en `src/lib/copy.ts` en vez de estar incrustado donde se envía. Cubre los
mensajes (Telegram y correo), las respuestas del bot, la pantalla de escucha,
la interrupción y la pregunta.

**Lo que escribe el modelo también.** El titular, el porqué, la pregunta y el
descriptor los escribe él, así que `languageInstruction()` va dentro del
prompt de la explicación, la decisión, la entrevista, el descriptor y el
intent. Sin eso, el sobre sale en castellano y el contenido en inglés — que es
exactamente lo que se vio en el móvil antes de arreglarlo.

**La extracción de claims no lleva idioma, a propósito.** La evidencia es casi
una cita del documento: traducirla la aleja de lo que ponía. Consecuencia:
mientras el grafo venga de un CV en inglés, la sección "POR QUÉ TÚ" cita en
inglés dentro de un mensaje en castellano. Se arregla re-extrayendo el grafo,
que cuesta llamadas al modelo y es decisión suya.

**Sin traducir todavía:** onboarding, procesado, entrevista, intent, el Mapa y
el laboratorio. Son otro rato largo y ninguno está en el bucle diario.

### Ocho preguntas, cinco iguales — y lo que se cambió

La primera sesión real por Telegram acabó con él diciendo que estaba harto de
preguntas, y tenía razón. Las ocho que le llegaron, resumidas: si ha
construido una audiencia de developers; qué hizo él en Asgard; si ha hecho
marketing de una herramienta técnica; qué ha construido él y cómo se gana la
credibilidad con developers; si ha gestionado presupuesto; si le vale paid
acquisition; qué plataformas llevaba en la comunidad de Manfred; y cuánto de
los 120k construyó él. **Cinco son la misma pregunta**, y la séptima y la
octava llegaron después de que contestara que construyó una comunidad de 120k.

Las causas, las dos mecánicas:

- **Las preguntas eran por oferta.** Cada oferta razonaba desde cero y volvía
  al mismo hueco. Sus respuestas sí entraban al grafo, pero nada le decía a la
  siguiente que eso ya lo había contado.
- **El índice que evitaba repetir comparaba el texto literal.** El modelo
  reformula siempre, así que no paraba nada.

Lo cambiado:

1. **Lo que ha contestado es perfil.** `candidateContext` lleva ahora
   `alreadyTold`: las respuestas de las ofertas **y las de la entrevista**, con
   sus palabras. Va en el prompt de match y en el de decisión con la regla
   escrita: lo que está ahí es conocido, no es un hueco, y no se vuelve a
   preguntar en ninguna reformulación.
2. **Un guardia determinista antes de preguntar.** `alreadyAnswered()` para la
   pregunta si el hueco (`unknown_id`) ya se contestó o si el solape de
   palabras con una contestada pasa de 0,6 —quitando las que no dicen de qué
   va la pregunta—. Lo que se cuela de ahí lo para el prompt. Cada descarte
   queda en el audit como `question_dropped_as_repeat`.
3. **Todas juntas, en un mensaje.** Las preguntas se acumulan
   (`AMBLE_QUESTION_BATCH_MINUTES`, 10 por defecto) y sale un solo aviso con
   las que haya. Antes salía una por pregunta en cuanto existía: con dos
   ofertas entrando a la vez, eso son cuatro avisos en diez minutos.
4. **Se puede contestar hablando.** Una nota de voz por Telegram se descarga,
   se transcribe con el mismo STT que la entrevista y sigue el mismo camino.
   Del audio no se guarda nada; la transcripción queda en la fila y se le
   enseña en el acuse, porque una transcripción mala que entra al grafo sin que
   nadie la vea es peor que no entender nada.

Y un bug de los caros, que salió mirando esto: **el trabajo que mete la
respuesta al grafo no era idempotente**. Se reintentó una vez tras un "empty
response" del modelo y dejó dos evidencias por cada frase que dijo una sola
vez ("I owned a 100k marketing budget at Manfred" está dos veces). Ahora
`incorporated_at` lo marca y un reintento solo vuelve a decidir.

**Lo que no está hecho:** que el onboarding pregunte de una vez lo que se
repite por oferta. Sigue siendo la siguiente.

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

### Todo lo que le llega al Rep es perfil — 21 de septiembre

Lo primero de la lista del 19, hecho. Un mensaje suyo sin nada abierto se
guardaba en `inbound_messages` con `nothing_pending` y ahí moría: eso
convertía al Rep en un formulario con conversación encima, porque le contabas
que te habías mudado y la siguiente oferta te preguntaba dónde vives.

Ahora las ramas que no consumen lo que escribió lo marcan con `asContext` y la
cola lo mete al grafo por la misma puerta que una respuesta:
`incorporateAnswer` con el mensaje como procedencia. Son cuatro ramas, no una:
nada abierto, una pregunta que ya estaba contestada, una interrupción ya
respondida, y palabras donde hacía falta un sí o un no. Un `/si` no, que no
dice nada del perfil.

Lo único distinto es la extracción. `extract_unprompted_claims` es una tarea
aparte porque el prompt de las respuestas miente aquí —dice que contestó a una
pregunta— y un modelo al que le dicen que hay una pregunta se inventa cuál es.
Le dice tres cosas que el otro no: que no se preguntó nada, que devolver cero
claims es lo normal, y que un cambio de lo que quiere («ya no quiero
guardias») sí es un claim. La reevaluación recibe lo mismo escrito en su
sitio: `(Nothing was asked...)` en vez de un hueco en blanco.

**Las dos decisiones que quedaban abiertas, decididas:**

- **Qué se le contesta.** No un segundo mensaje. El acuse dice lo que ha
  pasado de verdad —«pasa a formar parte de lo que sé de ti»— y si eso acaba
  cambiando una decisión, quien habla es la interrupción, que ya existe y
  tiene algo que decir. Un «apuntado» seguido de un «por cierto, ahora sí» son
  dos avisos por una frase suya, que es justo lo que pidió que no pasara.
- **Si un mensaje suelto reevalúa lo que está en HOLD.** Sí, pero solo cuando
  movió algo: si la incorporación no resolvió ninguna incertidumbre y no
  cambió ninguna capacidad, no se toca nada. Un «gracias» extrae en una
  llamada barata y ahí acaba. Cuando sí movió, van las cinco más recientes en
  espera (`MAX_REASSESSED_HOLDS`): una oferta que lleva tres semanas en HOLD no
  la rescata un mensaje de hoy.

Y un guardarraíl que ya nos costó una vez: `inbound_messages.incorporated_at`.
Sin él, un reintento tras un «empty response» extrae los mismos claims otra
vez y deja dos evidencias por cada frase dicha una sola vez — exactamente el
bug de las preguntas.

Nueve tests nuevos. Lo que **no** cubre: la pantalla no tiene caja para
contarle algo al Rep sin que haya pregunta abierta. Por Telegram sí, por la
web no.

## Fuera del portátil: Railway, la puerta y la libreta

### Lo que hay en el repo

- **`Dockerfile`** en tres etapas, sobre `node:24-alpine` —en 22 `node:sqlite`
  es experimental y avisa por stderr en cada arranque— con
  `output: "standalone"` en `next.config.ts` para que la imagen no lleve
  `node_modules` entero.
- **`railway.json`**: builder DOCKERFILE, health check en `/api/health`, y
  **`numReplicas: 1`**. Eso último no es una preferencia: la base es un
  fichero y la cola vive en el proceso, así que dos contenedores son dos colas
  sondeando el mismo bot de Telegram y actuando sobre el mismo mensaje.
- **`AMBLE_DATA_DIR`**, que es lo único que hacía falta tocar del código para
  que esto fuera posible. Sin la variable, `.amble-data/` junto al proyecto,
  como siempre; en Railway, el punto de montaje del volumen.

### La puerta

`src/proxy.ts` — que es como se llama ahora lo que era `middleware.ts`, que
está deprecado en Next 16 y desde esta versión corre en el runtime de Node.
Deja pasar `/login`, `/api/login` y `/api/health`, y nada más. Una API sin
cookie recibe 401 y no el HTML del login, que es un error de JSON raro diez
minutos después.

Sin `AMBLE_PASSWORD` no hay puerta, a propósito: en local se entra como
siempre. La cookie lleva el sha-256 de la contraseña y no la contraseña, y se
compara en tiempo constante.

Esto no es un sistema de cuentas y no pretende serlo. Es que el enlace por sí
solo no valga, porque ahí dentro está su CV.

### La libreta

`/feedback`. Una caja, un botón, y debajo lo que ya escribió agrupado por día,
con «hoy» y «ayer» antes que cualquier fecha. Se guarda en optimista: la nota
aparece antes de que conteste el servidor, y si falla vuelve a la caja con lo
que había escrito. Escribiendo en el metro, esperar un 201 para ver que la
frase existe es la diferencia entre usarlo y no usarlo.

Tabla `feedback_notes` en la misma base. Sin estado, sin etiquetas y sin
prioridad, y eso es la decisión: una idea que hay que clasificar antes de
poder apuntarla es una idea que no se apunta. Lo de convertirlas en trabajo
será otra conversación cuando haya veinte y se vea cómo se agrupan.

Está en la barra de arriba. Una idea a la que hay que llegar escribiendo una
URL a mano tampoco se apunta.

### Llevarse el grafo

`npm run push:db -- https://loquesea.up.railway.app`. Pide la contraseña, hace
una copia con `VACUUM INTO` —copiar el fichero mientras hay un `-wal` vivo se
lleva media base—, la sube, y después sube los ficheros de `uploads/`.

Al otro lado, `POST /api/admin/restore`, que es la ruta más destructiva del
proyecto y por eso tiene tres cerrojos: `AMBLE_ALLOW_RESTORE=true`, la
contraseña, y comprobar que lo que llega empieza por `SQLite format 3`. Cierra
la base antes de reemplazar el fichero —cambiarlo por debajo de una conexión
abierta es cómo se corrompe SQLite—, borra el `-wal` y el `-shm` de la
anterior, guarda lo que había con la fecha al lado, y la vuelve a abrir en la
misma petición para que un fichero malo se note ahora y no mañana.

Quitar `AMBLE_ALLOW_RESTORE` en cuanto termine.

### En pie — 21 de septiembre

https://amble-agent-production.up.railway.app, con su grafo dentro.

Dos cosas se aprendieron desplegando, y las dos estaban en el Dockerfile:

- **El volumen se monta siendo de root.** La imagen construyó, el contenedor
  arrancó, el health check se puso verde, y la primera página que tocó la base
  se cayó con `unable to open database file`. El `chown` del build se queda
  *debajo* del montaje. Lo arregla `docker-entrypoint.sh`: empieza como root,
  hace suyo el directorio ya montado, y baja con `su-exec`, que reemplaza el
  proceso en vez de envolverlo —el servidor sigue siendo PID 1 y recibe el
  SIGTERM del despliegue—. Con `.gitattributes` detrás, porque ese shebang
  leído con CRLF es un `bad interpreter`.
- **Borrar una variable no reinicia nada.** `AMBLE_ALLOW_RESTORE` siguió
  abierta hasta el siguiente despliegue. Si alguna vez se quita algo que
  importa, hay que redesplegar detrás y comprobarlo, no suponerlo.

Comprobado en vivo, sin cookie: `/feedback`, `/me`, `/listening` y
`/dev/user-zero` redirigen a `/login`; las APIs dan 401; `/api/admin/restore`
da 404 porque la variable ya no está; `/api/health` contesta 200, que es lo
que necesita Railway. Y una nota escrita antes de un redespliegue seguía ahí
después, que era la única forma de saber que el volumen es de verdad.

### Dos agujeros que solo se ven en un servidor — 21 de septiembre

**El bucle dormía.** Todo lo que reanuda el trabajo —la cola, el sondeo de
Telegram, las sincronizaciones, el outbox— colgaba de
`GET /api/opportunities/interruption`, que es lo que pide la pantalla de
listening cada seis segundos. En un portátil que se cierra por la noche eso
era exactamente lo correcto: lo que reanuda es la persona volviendo. En un
servidor significa que tras cada despliegue nadie escucha a Telegram hasta que
alguien abre la app — el bucle construido para funcionar sin la app abierta
dependía de que alguien la abriera.

Ahora va en `src/instrumentation.ts`, que Next llama una vez por instancia y
antes de la primera petición. Comprobado en vivo: tras el despliegue apareció
una oferta nueva de Manfred sin que nadie tocara nada.

**Y las que pasaron la criba y nadie llegó a mirar.** Un sondeo evalúa como
mucho diez por pasada; las que sobran se guardan en `received`, y en la pasada
siguiente se saltan por «ya conocida». Nunca se evaluaban. En la instancia
real eran diez ofertas que habían superado el filtro y sobre las que no se
dijo nada jamás — el fallo que este producto existe para no cometer, cometido
en silencio y sin una línea en el log.

El presupuesto se gasta ahora primero en lo que ya esperaba y después en lo
nuevo. Ese orden es la decisión, y es discutible: lo nuevo puede esperar seis
horas, lo que lleva esperando desde el martes ya ha esperado bastante. Con un
guardarraíl para que un sondeo reintentado no encole dos veces la misma oferta
—seis llamadas por una— y tres tests.

Visto funcionar en producción mientras se escribía esto: `received` bajando de
10 a 6 y `decided` subiendo de 6 a 9, una cada minuto y medio.

## El Rep contesta, y el anuncio ya no manda — 21 de septiembre

Los dos primeros pasos hacia el career advisor. El orden fue deliberado: cada
cosa que se le deje hacer al agente multiplica la superficie, así que sellar
va antes de ampliar.

### Que conteste cuando le preguntan

El bug era mío, de esta misma mañana: la rama de «todo lo que llega de él es
contexto» se tragaba también las preguntas, así que le preguntabas algo y te
respondía «apuntado». Le preguntabas y te archivaba.

Lo distingue `looksLikeAQuestion`, una heurística y dicha como tal — signo de
interrogación, o palabra interrogativa al principio. No una llamada al
modelo: una llamada para decidir si hace falta otra llamada es cómo esto
cuesta el doble sin ser el doble de listo. Y puede ser las dos cosas a la vez
(«me he mudado a Lisboa, ¿eso cambia algo?»): el hecho entra al grafo y la
pregunta se contesta.

`src/lib/pipeline/advisor.ts` es el asesor. Contesta con el grafo entero en el
prompt y con nada más, y las reglas del prompt son la disciplina de siempre un
piso arriba:

- Sobre él, sólo lo que sostenga el perfil.
- **Sobre el mercado, nada.** Ha visto las ofertas que ha visto y ninguna más.
- Lo que no sabe se dice. Un asesor que nunca dice «eso no lo sé de ti» está
  completando frases.
- Un consejo tiene que apoyarse en un hueco suyo, en un requisito que salió en
  lo que le llegó, o en algo que él dijo. Si no, es un horóscopo.

Lo contestado se guarda en `inbound_messages.answer`, y no sólo se envía: un
asesor que no recuerda lo que aconsejó es un oráculo. El prompt recibe las
cuatro últimas respuestas para no repetirse.

**Los transportes son distintos a propósito.** Telegram espera al modelo y
manda **un** mensaje, con `sendChatAction` de «escribiendo…» refrescado cada
cuatro segundos: medio minuto de silencio en un chat es una conversación
muerta, y un «déjame mirar» seguido de la respuesta son dos avisos por una
pregunta. La web no puede colgar una petición medio minuto desde un móvil, así
que encola y la pantalla vuelve a por ella, con dos minutos de tope.

Comprobado en producción, con su grafo de verdad. La respuesta nombró lo que
no sabía, citó la única oferta de Head of Growth que había leído, señaló tres
huecos concretos —analítica sin métodos, métricas autodeclaradas, tamaño de
equipo— y devolvió una sola pregunta.

### Que el anuncio no pueda mandar

El agujero, medido antes de tocarlo: el anuncio entraba al prompt a pelo,
cuarenta mil caracteres pegados a las instrucciones, y `COMPANY` y `ROLE`
—que vienen del feed— dentro de la cabecera. Un salto de línea en el nombre
de la empresa era una línea nueva de prompt. Cero defensas y cero tests.

Ahora `untrusted()` lo valla con un identificador que cambia en cada llamada
—si fuera fijo, bastaría con escribirlo una vez en el anuncio— y rompe dentro
del texto cualquier cosa que se le parezca, así que no se puede cerrar antes
de tiempo. `headerField()` deja los campos de cabecera en una línea y sin
caracteres de control. La rúbrica la escribió el modelo leyendo el anuncio, así
que en la etapa de match va vallada también.

Nueve tests en `prompts.test.ts`, y sólo prueban lo que se puede probar de
forma determinista: que el texto no se haga pasar por instrucción. Que
*convenza* al modelo es otro problema y lo para la capa de reglas, que ya
tiene los suyos.

Y dos huecos menores: diez intentos por cuarto de hora en `/api/login`, y la
cookie deja de ser `sha256("amble:" + contraseña)` —calculable offline contra
una cookie robada— para llevar una sal de este volumen. Se escribe con `wx` y
se relee: `proxy.ts` y la ruta pueden evaluarse en bundles distintos y pedirla
a la vez en el primer arranque, y dos sales distintas son un bucle de login
que no se arregla borrando cookies.

**Ojo:** el cambio de sal invalidó las sesiones. Hay que volver a entrar.

### Lo que queda de la lista de Borja

3. **La memoria de la conversación**, como cosa aparte y citable: qué se
   aconsejó, qué se acordó, qué dijo que iba a hacer. El grafo sigue siendo
   lo que él es; esto es el estado de una relación. Dos memorias que se
   contradicen las gana la que no se puede auditar, así que no puede ser un
   histórico de chat que el modelo relee.
4. **El modo asesor** encima de las dos anteriores.
5. Medir el ritmo real de fallo del modelo en Railway. El 17% que se midió era
   la cobertura de un tren, no el sistema, y el parte de excepciones todavía
   no ve los fallos que el reintento resuelve.

## Asesor, negociación y el bucle del tono — 21 de septiembre, tarde

### Lo que puede hacer el Rep ahora

- **Contesta preguntas**, y cada cosa que dice cita algo del grafo. Lo que no
  se puede trazar se descarta en vez de enseñarse, y se cuenta — objetivo cero,
  y va al registro en cada respuesta. Si no queda nada en pie, dice que no
  puede contestar sin inventárselo en vez de rellenar.
- **Se acuerda de lo que os habéis dicho** (`advice`): qué aconsejó, sobre qué
  hueco, y qué dijo él que iba a hacer. Se cierra solo cuando llega algo que
  cubre el hueco, y queda escrito qué lo cerró.
- **Le puedes pasar una oferta**, por enlace o pegada, y te dice qué pide y qué
  puedes enseñar — separando lo que puedes cerrar de lo que no («eso no es
  algo que puedas mejorar, es tiempo que no has vivido»).
- **Aconseja con los datos de las ofertas leídas**: qué piden las que más
  pagan y no puedes demostrar. Ese dato lo calculaba el match desde el
  principio y no lo leía nadie.

### El bucle del tono, que es lo siguiente que toca usar

En `/listening`, debajo de cada respuesta. Marcas qué falla —seis motivos, que
son botones porque un motivo escrito a mano no se puede contar— escribes cómo
lo quieres, y lo ves reescrito **sin desplegar nada**.

Funciona porque no vuelve a pensar la respuesta: los puntos ya están y ya
están auditados, sólo se rehacen las palabras. Una llamada corta en vez de
cuatro. Y el guardarraíl es que **un punto entra, un punto sale, en el mismo
orden** — las citas viajan por posición, así que un punto de más sería una
afirmación sin fuente colada por la puerta del estilo.

«Y háblame siempre así» lo guarda en preferencias (`preferences.tone`).

**Lo que hay que mirar al retomar:** la tabla `evaluations` (qué motivos se
repiten, por tarea y versión) y los eventos `answer_reworded` (qué tonos probó
y con cuál se quedó). Eso es lo que dice si el problema es el prompt o el
grafo. Hasta hoy tenía cero filas.

### La negociación, empezada

`src/domains/negotiation/` tiene las cinco decisiones del 19 hechas tipos, y
`pipeline/negotiation.ts` corre una conversación entera con las dos partes
dentro del mismo proceso. Diez tests que la corren de verdad.

Lo que no hace, y es lo que la hace barata: **no inventa preguntas**. Ya
existían — cada evaluación produce `unknowns` con su lado, `ASK_CANDIDATE` y
`ASK_COMPANY`, y llevaban ahí desde el primer día.

La asimetría es deliberada: la empresa contesta sólo lo que su oferta dice y
**para** cuando no lo sabe (decisión 2); el Rep contesta desde el grafo y lo
que sale pasa por la escalera (decisión 1). Y no hay turno de tipo «acuerdo»,
así que ningún agente puede declararlo (decisión 3).

**Lo que falta para que sea real**, por orden:

1. La voz del Rep: hoy `answerFromGraph` es un parámetro que el test rellena.
   En producción necesita una tarea que conteste un hueco desde el grafo
   devolviendo hechos citables — mismo patrón que el asesor, misma auditoría.
2. Las señales propias de la empresa: hoy `theirs = {0, 0}`. Su lado tiene que
   correr sus reglas sobre su presupuesto y sus condiciones, que es la otra
   mitad de la decisión 3.
3. Y después separar el despliegue. No antes: hasta tener 1 y 2 no se sabe qué
   tiene que cruzar el cable.

### Seguridad, hecha

Un anuncio entraba al prompt a pelo, con `COMPANY` y `ROLE` del feed dentro de
la cabecera — un salto de línea ahí era una línea nueva de prompt. Ahora va
vallado con un identificador que cambia en cada llamada. Nueve tests.

Y las guardas del enlace pegado, que es la única vez que este servidor pide a
donde le digan: sólo https, sólo direcciones públicas **resueltas antes de
pedir**, redirecciones seguidas a mano comprobando **cada salto** (rechazarlas
sin más era inservible: casi todos los tablones redirigen), y topes de tamaño
y tiempo. Ocho tests.

Más: diez intentos por cuarto de hora en la entrada, y la cookie con una sal
de este volumen en vez de un hash calculable offline.

### Lo que la instrumentación dice hoy

- **`/api/reliability`** da el ritmo de fallo también cuando es bueno. El
  8,5% que salió al medirlo **no era la red**: eran respuestas truncadas de
  `opportunity_match` (3 de 14) por un techo de 8.000 tokens. Subido a 20.000.
  El 17% de antes era la cobertura de un tren.
- **`npm run smoke`** abre todas las pantallas y endpoints. Habría cazado el
  500 de `/feedback` que pasó tipos, lint, 197 tests y el build.
- El prompt de match tiene techo: 60 evidencias, más del doble de las 28 que
  el modelo llegó a citar. No era para ahorrar hoy — era para que no crezca.

### Cerrado y no hay que volver a abrirlo

- La librería **no pregunta quién es el candidato en ningún sitio**. La
  identidad entra por la sesión y por el arranque. Comprobado contando.
- `railway.json` migrado a `.railway/railway.ts`.

## Lo siguiente, cuando retomemos

**Esta lista es del 21 y la de arriba la sustituye** — lo que manda ahora es
«Lo que queda de su lista», en la sección del 22. Lo de aquí sigue vivo pero
va detrás.

Del 21, y sin hacer:

1. **Tono y contenido**, con esos datos delante. Borja dijo que hay mucho que
   mejorar en las dos cosas, y esa es la conversación que sí se puede tener
   con evidencia.
2. **El onboarding que no se repite** (propiedad, escala, presupuesto). Lo más
   grande de lo que queda: toca la entrevista, que es la parte que funciona.
3. **La negociación**, por los tres pasos del § de arriba.

**Lo suyo, cuando quiera:** el resto del Intent sigue siendo mío —remoto
innegociable, Valencia, AI infra, Seed/Serie A— aunque el suelo ya es suyo
(80.000 desde hoy). Dijo que las pruebas que hay dentro no le preocupan y que
ya las cambiará: **Nomad Compute, las dos evidencias duplicadas y las
fixtures** se quedan a propósito, no son un descuido.

**Dos preguntas suyas sin contestar:** si «atribución» le sobra del
vocabulario o es normal en growth, y dónde publica Tinybird — no tiene tablón
en Greenhouse ni en Ashby. Anthropic y OpenAI sí, y ya están en
`AMBLE_ATS_BOARDS`.

**Lo que sigue sin comprobarse:** la app en una pantalla de móvil de verdad
—nunca la he visto— y el camino de Telegram con un enlace pegado, que no puedo
probar porque no puedo escribirle a su bot.

## Decidido en User Zero, no volver a abrirlo

- El copy de la pantalla de listening se revisó el 18 de septiembre y **se
  queda como está**, incluidos los tres puntos de "FROM HERE". Repiten en
  parte la promesa de la línea grande de arriba, y aun así se quedan: dicen la
  mecánica concreta, que la promesa no dice.
- Arrastrar ficheros está **probado por Borja en su navegador**, funciona.

## Cómo retomar

```bash
cd C:\dev\amble
npm test                      # 254 tests, sin red y sin base real
npm run dev                   # http://localhost:3000
npm run check:model           # comprueba el modelo en 2 llamadas cortas
npm run measure -- <cv.pdf>   # sesión entera por API, cronometrada
npm run measure:opportunities # las diez fixtures, con el dev levantado
npm run reset:opportunities   # quita las fixtures, deja el grafo
npm run push:db -- <url>      # lleva esta base al servidor
npm run smoke -- <url>        # abre cada pantalla y cada endpoint
```

En pie en **https://amble-agent-production.up.railway.app** — contraseña en el
gestor de Borja, y si se pierde se cambia `AMBLE_PASSWORD` en Railway.

Para traer ofertas de Manfred: el botón del laboratorio, o

```bash
curl -X POST localhost:3000/api/sources/manfred   -H 'Content-Type: application/json' -d '{"limit":40,"maxEvaluations":10}'
```

Para probar Telegram de ida y vuelta: token en `.env.local`,
`npm run telegram:whoami` para sacar el chat id, pegarlo en la pantalla de
listening, y a partir de ahí contestarle al bot. Sin chat id guardado no se
sondea nada, a propósito.

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
