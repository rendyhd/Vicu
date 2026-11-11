import { useId, useState } from 'react'
import { FileUp } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { useCalendarImportStore } from '@/stores/calendar-import-store'
import { usePlanEventActions } from '@/hooks/use-plan-events'
import { formatLength } from '@/lib/planner-timeline'
import type { IcsImportPreview } from '../../../shared/ics-import'
import { repeatText, type PlanEvent } from '../../../shared/plan-events'

// Importing a calendar file into Events, once (contract 20.10, plan phase 2f). Main opens the file
// dialog and reads the file; this shows what it becomes and writes the Events in one synced change
// with Undo. Afterwards they are ordinary Events: nothing stays linked to the file.

function dayText(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function whenText(event: PlanEvent): string {
  const time = event.time === null ? 'all day' : `${event.time}, ${formatLength(event.minutes)}`
  return event.repeat.kind === 'none' ? `${dayText(event.start)}, ${time}` : `${repeatText(event.repeat)} from ${dayText(event.start)}, ${time}`
}

function countText(events: readonly PlanEvent[]): string {
  const repeating = events.filter((event) => event.repeat.kind !== 'none').length
  const single = events.length - repeating
  const total = events.length === 1 ? '1 Event' : `${events.length} Events`
  return `${total}: ${repeating} repeating, ${single} single.`
}

function PreviewDialog({ preview, onClose }: { preview: IcsImportPreview; onClose: () => void }) {
  const titleId = useId()
  const actions = usePlanEventActions()
  const [busyOnly, setBusyOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const events = busyOnly ? preview.busyOnly : preview.events

  const importAll = async () => {
    if (saving || events.length === 0) return
    setSaving(true)
    const done = await actions.addMany(events)
    setSaving(false)
    if (done) onClose()
  }

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-[480px] max-w-[92vw]">
      <div className="space-y-3 p-5" data-calendar-import-dialog>
        <h2 id={titleId} className="text-card-title font-semibold text-text">Import {preview.fileName}</h2>
        {events.length === 0 ? (
          <p className="text-meta text-text" data-calendar-import-empty>
            Nothing in this file to import. Events that ended before today, cancelled ones and those more than a year ahead are left out.
          </p>
        ) : (
          <>
            <p className="text-meta text-text" data-calendar-import-count>{countText(events)}</p>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-control border border-border p-1.5" data-calendar-import-list>
              {events.map((event, index) => (
                <li key={index} className="px-1 py-0.5" data-calendar-import-item>
                  <span className="block truncate text-meta text-text">{event.title}</span>
                  <span className="block truncate text-caption text-text-secondary">{whenText(event)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={busyOnly} onChange={(e) => setBusyOnly(e.target.checked)} data-calendar-import-busy-only />
          <span className="text-meta text-text">Show only &ldquo;Busy&rdquo;, not titles</span>
        </label>
        <p className="text-caption text-text-secondary">
          They become ordinary Events: shown on Plan, changeable, and synced to your devices through your Vikunja server. Nothing stays
          linked to the file; importing it again makes them again.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void importAll()} disabled={saving || events.length === 0} data-calendar-import-confirm>
            {events.length === 1 ? 'Import 1 Event' : `Import ${events.length} Events`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** "Import calendar file...": the file dialog, then the preview (drawn by ImportCalendarHost). */
export function ImportCalendarFileButton({ className }: { className?: string }) {
  const reading = useCalendarImportStore((state) => state.reading)
  const pick = useCalendarImportStore((state) => state.pick)
  return (
    <Button variant="secondary" className={className} onClick={() => void pick()} disabled={reading} data-calendar-import-open>
      <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
      Import calendar file...
    </Button>
  )
}

/** The preview of an import, outside any popover: mounted by the Plan screen and the calendar settings. */
export function ImportCalendarHost() {
  const preview = useCalendarImportStore((state) => state.preview)
  const close = useCalendarImportStore((state) => state.close)
  return preview ? <PreviewDialog key={`${preview.fileName}:${preview.events.length}`} preview={preview} onClose={close} /> : null
}
