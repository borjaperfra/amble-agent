import fs from 'node:fs'

// The browser forms are filled with: the one installed on the machine. Kept
// apart from the filling itself, so that asking whether there is one never
// loads the automation library (the host has neither).
export const CHROME = process.env.AMBLE_CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// Whether this server has a browser to fill forms with. The host has none yet:
// there, what the Rep prepared is copied into the offer's own form by hand.
export function canFillForms(): boolean {
  return fs.existsSync(CHROME)
}
