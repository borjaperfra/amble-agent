@AGENTS.md

# amble is live: read DEVELOPMENT.md before changing anything

@DEVELOPMENT.md

The short version:
- Production (https://app.amble.fyi, branch `main`) has real people: never point local or staging at their WhatsApp, inboxes or database.
- Matching, WhatsApp, onboarding, applications and schema changes go through branch `staging` first; small copy fixes may go straight to `main`.
- A push to `main` restarts production: deploy outside the listening passes (08/12/16/20 Madrid) and when nobody is mid-setup.
- Work against an anonymised replica (`npm run db:pull`), not production; back up before any write on the server.
- After `railway environment link staging`, link production back at once; prefer `--environment` on every command.
