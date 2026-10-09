# Working on amble now that people use it

amble is live at https://app.amble.fyi with beta testers on it. Their data,
their WhatsApp and their inboxes are real. This is how changes reach them
without anyone being written to by mistake or losing what they were doing.

## Three environments

| | Where | Data | WhatsApp | Email | Listening |
|---|---|---|---|---|---|
| **Local** | `npm run dev` | `.amble-data/` (yours) or a replica (`npm run db:pull`) | Zernio's shared sandbox number only | off: emails print to the console | off (run passes by hand) |
| **Staging** | Railway `amble-web` › environment `staging` › service `app-staging`, deployed from branch `staging` | its own volume, empty or a replica | none for now (see below) | Resend, to whoever signs in there | off (`AMBLE_SCHEDULE_LISTENING=0`) |
| **Production** | Railway `amble-web` › `production` › `app`, deployed from `main`, https://app.amble.fyi | `/data` volume, backed up daily | the +34 960 29 18 09 number | Resend | on, at 08/12/16/20 Madrid |

## Rules

1. **Never point a local or staging run at production's people.** No production
   `ZERNIO_ACCOUNT_ID`/`ZERNIO_NUMBER` outside production; no `RESEND_API_KEY`
   in `.env.local`; never open production's database directly to write to it
   from a laptop.
2. **A replica is anonymised before it is opened.** `npm run db:pull` (into
   `.amble-data/replica/`, then `AMBLE_DATA_DIR=.amble-data/replica`) removes
   sessions, sign-in codes and links, WhatsApp links and other people's
   conversations, and turns every email but the owner's into
   `@example.invalid`. It is still personal data (careers, answers): delete it
   when done. Uploaded files are not copied.
3. **Every change goes on a branch.** Small copy fixes may go straight to `main`.
   Anything touching matching (`src/lib/matching`), WhatsApp
   (`src/lib/whatsapp`), onboarding (`src/lib/pipeline`, `src/app/onboarding`),
   applications (`src/lib/apply`) or the database schema (`src/lib/db/db.ts`)
   goes through staging first: merge into `staging`, try it on the phone at the
   staging URL, then into `main`.
4. **A push to `main` deploys production and restarts the server.** What lives
   in memory is lost: a setup being read, a first read under way, a form open in
   the cloud browser. Deploy outside the listening passes (08/12/16/20 Madrid,
   each up to 3.5 h; the scheduler resumes an interrupted pass, but it reads
   again), and check /admin › Salud that nobody is mid-setup.
5. **Schema changes are additive.** `CREATE TABLE IF NOT EXISTS`, new columns
   with defaults, new indexes `IF NOT EXISTS`; never drop or rename in the same
   deploy that stops using something. Take a backup first (rule 11).
6. **A new assessor or role-query version re-reads offers for everyone**
   (`ASSESS_VERSION`, `ROLE_QUERY_VERSION`, task versions in
   `src/lib/model/tasks.ts`): model cost and hours of passes. Bundle such
   changes and say so before deploying.
7. **WhatsApp templates go to Meta one at a time**, days apart
   (`npm run whatsapp:templates -- create <name>`): ten at once got the account
   locked. Nothing that reads like a job offer from a stranger.
8. **Tests that write run on copies.** Before a script writes to
   `.amble-data/amble.db`, `VACUUM INTO` a backup and restore it after, unless
   the write is the point. Model calls in tests use a key of their own, not
   production's.
9. **On the server, read-only checks go through `railway ssh --environment
   production --service app`**; anything that writes (deleting an account,
   restoring) starts with a backup (rule 11).
10. **The folder is linked to production.** `railway environment link staging`
    changes where every later `railway` command goes; link production back right
    after (`railway environment link production`), and prefer passing
    `--environment` explicitly.
11. **The volume is small (4.6 GB) and full stops everything.** On 2026-10-09
    copies filled it and every pass failed. The daily copy is compressed
    (`/data/backups/amble-<day>.db.gz`, gunzip it to restore); anything in
    `/data/backups/` older than 7 days is deleted by the next copy, by-hand
    copies too (that is also what amble promises about a deleted account). A
    copy by hand goes to `/tmp` first and lands compressed:
    `VACUUM INTO '/tmp/x.db'`, then `gzip -c /tmp/x.db > /data/backups/x.db.gz && rm /tmp/x.db`.
    Delete it once the change holds. /admin › Salud › Volumen shows the room
    left; over 80 % an alert goes out.

## Staging

- URL: https://app-staging-staging-d220.up.railway.app (sign in as the owner:
  the replica keeps only the owner's email).
- Deploy: `git push origin <branch>:staging` (or merge into `staging`).
- Fresh data: `npm run db:pull`, then gzip `.amble-data/replica/amble.db`,
  `railway volume --environment <staging id> files -v app-staging-volume upload
  <file>.gz /replica.db.gz`, and over `railway ssh --environment staging
  --service app-staging`: `cd /data && gunzip -f replica.db.gz && mv -f
  replica.db amble.db && rm -f amble.db-wal amble.db-shm`; then restart the
  service from the dashboard. (The restore route refuses a body this large.)
- Variables: model, Browserbase and Resend only; `AMBLE_SCHEDULE_LISTENING=0`.

## Staging, still to do

- WhatsApp on staging needs its own webhook: Zernio's webhook is global, so a
  second one pointing at staging must be limited to the sandbox account
  (`accountIds`), and production's to the +34 account, before staging gets
  `ZERNIO_*`.
- A custom domain (app-staging.amble.fyi) instead of the Railway one, if wanted.
- A separate model API key for staging and local loops.
