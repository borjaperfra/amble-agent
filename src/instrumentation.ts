/**
 * Lo que tiene que pasar al arrancar, sin que nadie abra nada.
 *
 * Hasta ahora todo esto colgaba de `GET /api/opportunities/interruption`: la
 * pantalla de listening lo pide cada seis segundos, así que era el latido más
 * barato de la app. En un portátil que se cierra por la noche eso era lo
 * correcto — lo que reanuda el trabajo es la persona volviendo.
 *
 * En un servidor es un agujero, y justo en la promesa del producto. Tras cada
 * despliegue el proceso arranca, el health check se pone verde y nadie está
 * escuchando a Telegram: el bucle que se construyó para funcionar sin la app
 * abierta depende de que alguien abra la app. Y los trabajos que quedaron a
 * medias en el despliegue anterior siguen en la cola sin que nadie los mire.
 *
 * `register` se llama una vez por instancia del servidor y antes de atender la
 * primera petición, que es exactamente lo que hacía falta. Nada de esto
 * bloquea: encolar y drenar son sincrónicos y el trabajo ocurre después.
 */
export async function register(): Promise<void> {
  // Se llama también en otros runtimes, donde no hay ni base ni cola. La
  // importación va dentro por lo mismo: fuera, el módulo entero se evalúa
  // durante el build.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { isUserZero } = await import('@/lib/features')
  if (!isUserZero()) return

  try {
    const { getOrCreateCandidate } = await import('@/lib/db/repo')
    const { resumeQueue } = await import('@/lib/pipeline/jobs')
    const { ensureInboundPolling } = await import('@/lib/pipeline/inbound-telegram')
    const { ensureSyncScheduled } = await import('@/lib/pipeline/source-sync')
    const { resumeUnsentNotices } = await import('@/lib/pipeline/notify')

    const candidateId = getOrCreateCandidate().id

    // Lo que se quedó a medias cuando el proceso anterior se fue.
    resumeQueue()
    // Escuchar la respuesta, que es la mitad del bucle que no depende de él.
    ensureInboundPolling(candidateId)
    // Y las dos que se reprograman solas, por si el despliegue cayó justo en
    // la ventana en la que tocaba.
    ensureSyncScheduled(candidateId, 'sync_manfred')
    ensureSyncScheduled(candidateId, 'sync_ats')
    resumeUnsentNotices(candidateId)
  } catch (error) {
    // Un arranque no se cae por esto. Sin base todavía —el primer despliegue
    // contra un volumen vacío— no hay candidato que buscar, y la primera
    // petición hará lo mismo que iba a hacer esto.
    console.error(
      'No se pudo reanudar el trabajo al arrancar:',
      error instanceof Error ? error.message : error,
    )
  }
}
