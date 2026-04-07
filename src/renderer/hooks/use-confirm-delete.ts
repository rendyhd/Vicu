import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '@/lib/api'

export function useConfirmDelete() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const resolveRef = useRef<((value: boolean) => void) | null>(null)
  const confirmEnabled = useRef(true)

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config) {
        confirmEnabled.current = config.confirm_before_delete !== false
      }
    })
  }, [])

  const confirmDelete = useCallback((msg: string): Promise<boolean> => {
    if (!confirmEnabled.current) return Promise.resolve(true)
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setMessage(msg)
      setOpen(true)
    })
  }, [])

  const onConfirm = useCallback(() => {
    setOpen(false)
    resolveRef.current?.(true)
    resolveRef.current = null
  }, [])

  const onCancel = useCallback(() => {
    setOpen(false)
    resolveRef.current?.(false)
    resolveRef.current = null
  }, [])

  return {
    confirmDelete,
    dialogProps: { open, message, onConfirm, onCancel },
  }
}
