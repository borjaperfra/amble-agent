#!/bin/sh
#
# Arranca como root, hace suyo el volumen, y baja.
#
# Railway monta el volumen sobre `AMBLE_DATA_DIR` siendo de root, y el
# `chown` del Dockerfile se queda debajo del montaje: para el proceso ya no
# existe. Un servidor corriendo como `nextjs` contra ese directorio arranca
# bien, pasa el health check, y se cae en la primera página que toque la base
# con `unable to open database file`.
#
# Así que lo único que hace root aquí es esto, y a la siguiente línea ya no es
# root: `su-exec` reemplaza el proceso, no lo envuelve, de modo que el
# servidor sigue siendo PID 1 y recibe el SIGTERM del despliegue tal cual.
set -e

DATA_DIR="${AMBLE_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"
chown -R nextjs:nodejs "$DATA_DIR"

exec su-exec nextjs:nodejs "$@"
