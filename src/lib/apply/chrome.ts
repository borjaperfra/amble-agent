import fs from 'node:fs'

// The browser forms are filled with: the one installed on the machine. Kept
// apart from the filling itself, so that asking whether there is one never
// loads the automation library (the host has neither).
export const CHROME = process.env.AMBLE_CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// Whether forms can be filled from here: a browser in the cloud, or one on
// this machine. Without either, what the Rep prepared is copied into the
// offer's own form by hand.
export function canFillForms(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY) || fs.existsSync(CHROME)
}
