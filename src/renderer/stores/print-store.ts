import { useEffect } from 'react'
import { create } from 'zustand'
import type { PrintablePayload } from '@/lib/print-template'

interface PrintState {
  payload: PrintablePayload | null
  setPayload: (payload: PrintablePayload) => void
  clearPayload: () => void
}

export const usePrintStore = create<PrintState>((set) => ({
  payload: null,
  setPayload: (payload) => set({ payload }),
  clearPayload: () => set({ payload: null }),
}))

// Keeps the store in sync with the tasks currently on screen so Ctrl+P always
// prints what the user is looking at. Views must call this before any
// early-return (hooks order). Pass a useMemo'd payload to avoid re-setting on
// every render.
export function usePrintable(payload: PrintablePayload): void {
  const setPayload = usePrintStore((s) => s.setPayload)
  const clearPayload = usePrintStore((s) => s.clearPayload)
  useEffect(() => {
    setPayload(payload)
  }, [payload, setPayload])
  useEffect(() => () => clearPayload(), [clearPayload])
}
