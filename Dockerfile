# Amble, para un servidor que no se apaga.
#
# La forma de esto la decide una cosa: el estado vive en disco. La base es
# SQLite en `.amble-data/` y la cola de trabajos vive dentro del proceso, así
# que esto es un servidor largo con un volumen montado, no una función que se
# levanta por petición. Un segundo contenedor corriendo a la vez tendría su
# propia cola sondeando el mismo Telegram: **una réplica, siempre**.
#
# Node 24 porque `node:sqlite` es estable ahí. En 22 existe, pero es
# experimental y avisa por stderr en cada arranque.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# El build no habla con el modelo ni con Telegram, pero sí importa los
# módulos que los configuran: una clave de mentira evita que alguno se queje
# al evaluarse, y ninguna de las dos acaba en la imagen final.
ENV AMBLE_MODEL_API_KEY=build-time-placeholder
ENV AMBLE_MODEL_ID=build-time-placeholder
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# El volumen de Railway se monta aquí. Sin esta variable la base se
# escribiría dentro del contenedor y desaparecería en el siguiente despliegue.
ENV AMBLE_DATA_DIR=/data

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Lo que `output: "standalone"` deja preparado: el servidor con sus
# dependencias trazadas, y los estáticos aparte porque el trazado no los mira.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Existe por si se arranca sin volumen: sin el directorio, el primer arranque
# se cae antes de poder decir qué le falta.
RUN mkdir -p /data && chown nextjs:nodejs /data

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
