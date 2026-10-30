import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { CALDAV_QUERY_KEY } from '@/hooks/use-caldav'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { SecretStorageNotice } from '@/components/settings/SecretStorageNotice'
import type { CalDavConnection, CalDavConnectionInput } from '../../../shared/caldav-types'

const fieldClass = 'w-full rounded-control border border-border bg-bg-page px-3 py-2 text-meta text-text'
const emptyForm = (): CalDavConnectionInput => ({ id: crypto.randomUUID(), name: '', url: '', username: '', authMethod: 'Basic', secret: '' })

export function CalDavSettings() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CalDavConnectionInput | null>(null)
  const [editingSaved, setEditingSaved] = useState(false)
  const { data: connections = [], error: loadError } = useQuery({
    queryKey: [...CALDAV_QUERY_KEY, 'connections'], queryFn: api.caldav.connections,
  })
  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CALDAV_QUERY_KEY }),
    // Keep the form and show the error beside it, rather than also showing a global toast.
    meta: { silent: true },
  })
  const edit = (connection: CalDavConnection) => {
    mutation.reset()
    setEditingSaved(true)
    setForm({ id: connection.id, name: connection.name, url: connection.url, username: connection.username, authMethod: connection.authMethod })
  }
  return (
    <section aria-labelledby="caldav-settings-title" className="space-y-4 rounded-card border border-border bg-bg-page p-5">
      <h2 id="caldav-settings-title" className="text-section text-text">Calendars</h2>
      <p className="text-meta text-text-secondary">
        Show CalDAV calendars in Planner. Discover calendars using your server or calendar URL and select those to display.
        Drag or resize a timed event to save its new schedule to the calendar. Recurring edits change only that occurrence.
        All-day events are shown in a separate read-only strip.
      </p>
      {connections.map((connection) => (
        <div key={connection.id} className="space-y-2 border-b border-border pb-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-group text-text">{connection.name}</h3>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={mutation.isPending} onClick={() => edit(connection)}>Edit / Discover</Button>
              <Button variant="secondary" danger disabled={mutation.isPending} onClick={() => mutation.mutate(async () => {
                await api.caldav.remove(connection.id)
                if (form?.id === connection.id) setForm(null)
              })}>Remove</Button>
            </div>
          </div>
          {connection.calendars.map((calendar) => (
            <label key={calendar.url} className="flex items-center gap-2 text-meta text-text">
              <Checkbox checked={calendar.enabled} disabled={mutation.isPending} onChange={(event) => {
                const enabled = event.target.checked
                mutation.mutate(() => api.caldav.select(connection.id, connection.calendars.map((item) => item.url === calendar.url ? { ...item, enabled } : item)))
              }} />
              <span aria-hidden="true" className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: calendar.color }} />
              {calendar.name}{calendar.readOnly ? ' (read-only)' : ''}
            </label>
          ))}
        </div>
      ))}
      {form ? (
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate(async () => {
            await api.caldav.discover(form)
            setForm(null)
          })
        }}>
          <label className="block space-y-1 text-meta text-text-secondary">
            <span>Name</span>
            <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Personal calendars" />
          </label>
          <label className="block space-y-1 text-meta text-text-secondary">
            <span>CalDAV URL</span>
            <input type="url" required className={fieldClass} value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://calendar.example.com/dav/" />
          </label>
          <label className="block space-y-1 text-meta text-text-secondary">
            <span>Authentication</span>
            <select className={fieldClass} value={form.authMethod} onChange={(event) => setForm({ ...form, authMethod: event.target.value as CalDavConnectionInput['authMethod'] })}>
              <option value="Basic">Username and password (Basic)</option>
              <option value="Digest">Username and password (Digest)</option>
              <option value="Bearer">Bearer token</option>
              <option value="None">None</option>
            </select>
          </label>
          {(form.authMethod === 'Basic' || form.authMethod === 'Digest') && (
            <label className="block space-y-1 text-meta text-text-secondary">
              <span>Username</span>
              <input autoComplete="username" className={fieldClass} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            </label>
          )}
          {form.authMethod !== 'None' && (
            <label className="block space-y-1 text-meta text-text-secondary">
              <span>{form.authMethod === 'Bearer' ? 'Access token' : 'Password / app password'}</span>
              <input type="password" autoComplete="new-password" className={fieldClass} value={form.secret ?? ''} onChange={(event) => setForm({ ...form, secret: event.target.value })} placeholder={editingSaved ? 'Leave unchanged to use the saved secret' : ''} />
            </label>
          )}
          <p className="text-caption text-text-secondary">Use HTTPS to protect credentials in transit. Some providers require an app password. Credentials stay on this device and are not synced with Vikunja.</p>
          <SecretStorageNotice />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? 'Connecting…' : 'Discover and save'}</Button>
            <Button variant="secondary" disabled={mutation.isPending} onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" disabled={mutation.isPending} onClick={() => {
          mutation.reset()
          setEditingSaved(false)
          setForm(emptyForm())
        }}>Add CalDAV connection</Button>
      )}
      {(mutation.error || loadError) && <p role="alert" className="text-meta text-danger">{(mutation.error || loadError)?.message}</p>}
    </section>
  )
}
