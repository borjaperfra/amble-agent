# amble, as one container: the Next server, scheduled listening inside it, and
# everything it keeps (SQLite and the files people give it) on a volume at
# /data. Node 24 for node:sqlite.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS run
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
# The volume is mounted here; it may arrive owned by root, so the server runs
# as the image's default user rather than guessing the volume's owner.
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "server.js"]
