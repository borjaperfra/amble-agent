# amble, as one container: the Next server, scheduled listening inside it, and
# everything it keeps (SQLite and the files people give it) on a volume at
# /data. Node 24 for node:sqlite, from the AWS mirror of Docker's official
# images: the same image, without Docker Hub's pull limit, which stopped
# builds on 2026-10-09 (429 on node:24-slim).

FROM public.ecr.aws/docker/library/node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM public.ecr.aws/docker/library/node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM public.ecr.aws/docker/library/node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    AMBLE_DATA_DIR=/data \
    AMBLE_SCHEDULE_LISTENING=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The cloud browser's library, whole: the server's own copy is traced from
# what the code imports and leaves out the files it reads at run time
# (browsers.json), so filling a form failed before it began (2026-10-02, 10-12).
COPY --from=deps /app/node_modules/playwright-core ./node_modules/playwright-core
# The volume is mounted here; it may arrive owned by root, so the server runs
# as the image's default user rather than guessing the volume's owner.
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "server.js"]
