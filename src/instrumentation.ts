// Runs once when the server starts. On a host, it starts scheduled listening
// (AMBLE_SCHEDULE_LISTENING=1); locally the Windows task does that instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.AMBLE_SCHEDULE_LISTENING !== '1') return
  const { startListeningSchedule } = await import('./lib/schedule')
  startListeningSchedule()
}
