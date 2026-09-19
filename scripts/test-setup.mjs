/** Registers the resolution hook before any test file is loaded. */
import { register } from 'node:module'

register('./test-resolve.mjs', import.meta.url)
