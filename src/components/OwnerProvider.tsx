'use client'

import { createContext, useContext } from 'react'

// Whether the person signed in is the owner: only to show the way to the
// admin. What the admin shows is decided on the server, never by this.
const OwnerContext = createContext(false)

export function OwnerProvider({ owner, children }: { owner: boolean; children: React.ReactNode }) {
  return <OwnerContext.Provider value={owner}>{children}</OwnerContext.Provider>
}

export function useIsOwner(): boolean {
  return useContext(OwnerContext)
}
