import ICAL from 'ical.js'

export interface IcsOccurrence {
  uid: string
  recurrenceId: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  readOnly: boolean
}

/** A component owns its VTIMEZONE definitions; never leak one server's zones into another. */
function parse(data: string): ICAL.Component {
  const root = new ICAL.Component(ICAL.parse(data))
  if (root.name !== 'vcalendar') throw new Error('Not an iCalendar document')
  return root
}

/** Resolve bare IANA TZIDs too (ical.js intentionally ships without a timezone database). */
function instant(time: ICAL.Time, event: ICAL.Event, property: 'dtstart' | 'dtend'): Date {
  const tzid = event.component.getFirstProperty(property)?.getParameter('tzid')
  if (!time.isDate && time.zone.tzid === 'floating' && typeof tzid === 'string') {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    const desired = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
    let value = desired
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(format.formatToParts(value).map((part) => [part.type, part.value]))
      const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
      const next = value + desired - shown
      if (next === value) break
      value = next
    }
    return new Date(value)
  }
  return time.toJSDate()
}

export function expandIcs(data: string, from: Date, to: Date): IcsOccurrence[] {
  const root = parse(data)
  const events = root.getAllSubcomponents('vevent').map((component) => new ICAL.Event(component))
  const result = new Map<string, IcsOccurrence>()
  const append = (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrenceId: string) => {
    if (event.component.getFirstPropertyValue('status') === 'CANCELLED') return
    const startDate = instant(start, event, 'dtstart')
    const endDate = instant(end, event, event.component.hasProperty('dtend') ? 'dtend' : 'dtstart')
    if (endDate < startDate || startDate >= to || (endDate > startDate ? endDate <= from : startDate < from)) return
    result.set(`${event.uid}/${recurrenceId}`, {
      uid: event.uid, recurrenceId, title: event.summary || 'Untitled event',
      start: startDate, end: endDate, allDay: start.isDate,
      // Changing a range override could move future instances, not just the dragged occurrence.
      readOnly: event.component.getFirstProperty('recurrence-id')?.getParameter('range') === 'THISANDFUTURE',
    })
  }
  for (const event of events.filter((item) => !item.isRecurrenceException())) {
    const exceptions = events.filter((item) => item.uid === event.uid && item.isRecurrenceException())
    for (const exception of exceptions) event.relateException(exception)
    if (!event.isRecurring()) {
      append(event, event.startDate, event.endDate, '')
      continue
    }
    const iterator = event.iterator()
    // Bound hostile or extremely old secondly rules rather than blocking the main process forever.
    let count = 0
    for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
      if (++count > 100_000) throw new Error('Calendar recurrence is too large to expand')
      if (instant(occurrence, event, 'dtstart') >= to) break
      const details = event.getOccurrenceDetails(occurrence)
      append(details.item, details.startDate, details.endDate, occurrence.toString())
    }
  }
  // Detached/moved exceptions may overlap this day even when their original occurrence does not.
  for (const event of events.filter((item) => item.isRecurrenceException())) {
    append(event, event.startDate, event.endDate, event.recurrenceId.toString())
  }
  return [...result.values()]
}

/** Preserve the resource, alarms, zones and unrelated properties; edit only this occurrence. */
export function rescheduleIcs(data: string, uid: string, recurrenceId: string, start: Date, end: Date): string {
  const root = parse(data)
  const components = root.getAllSubcomponents('vevent')
  const master = components.find((component) => component.getFirstPropertyValue('uid') === uid && !component.hasProperty('recurrence-id'))
  let target = components.find((component) => component.getFirstPropertyValue('uid') === uid
    && (component.getFirstPropertyValue('recurrence-id')?.toString() ?? '') === recurrenceId)
  if (!target && recurrenceId && master) {
    target = new ICAL.Component(structuredClone(master.toJSON()))
    for (const name of ['rrule', 'rdate', 'exdate', 'exrule']) target.removeAllProperties(name)
    const original = ICAL.Time.fromString(recurrenceId, undefined)
    original.zone = new ICAL.Event(master).startDate.zone
    target.updatePropertyWithValue('recurrence-id', original)
    // Preserve a bare IANA zone even when no VTIMEZONE was supplied.
    const tzid = master.getFirstProperty('dtstart')?.getParameter('tzid')
    if (tzid) target.getFirstProperty('recurrence-id')?.setParameter('tzid', tzid)
    root.addSubcomponent(target)
  }
  if (!target) throw new Error('Event no longer exists')
  if (target.getFirstProperty('recurrence-id')?.getParameter('range') === 'THISANDFUTURE') throw new Error('Range exceptions are read-only')
  target.removeAllProperties('duration')
  target.removeAllProperties('dtstart')
  target.removeAllProperties('dtend')
  target.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(start, true))
  // DATE-TIME events without an end are instantaneous; an equal DTEND would be invalid ICS.
  if (end > start) target.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(end, true))
  const now = ICAL.Time.fromJSDate(new Date(), true)
  target.updatePropertyWithValue('dtstamp', now)
  target.updatePropertyWithValue('last-modified', now)
  target.updatePropertyWithValue('sequence', Number(target.getFirstPropertyValue('sequence') ?? 0) + 1)
  return root.toString()
}
