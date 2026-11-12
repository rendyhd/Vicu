import { usePro } from '@/hooks/use-pro'
import { useProUiStore } from '@/stores/pro-ui-store'
import { RecapDialog } from './RecapDialog'
import { CopilotDialog } from './CopilotDialog'
import { ImportDialog } from './ImportDialog'

/** Pro's dialogs, opened from the palette, shortcuts, pages and the paste handler. Drawn once in AppShell. */
export function ProDialogHost() {
  const dialog = useProUiStore((s) => s.dialog)
  const input = useProUiStore((s) => s.dialogInput)
  const close = useProUiStore((s) => s.close)
  const pro = usePro()
  if (!dialog || !pro.layer('promises')) return null
  if (dialog === 'pro-recap') return <RecapDialog onClose={close} personId={input?.personId} />
  if (dialog === 'pro-copilot') return <CopilotDialog onClose={close} personId={input?.personId} />
  return <ImportDialog onClose={close} initialText={input?.text ?? ''} />
}
