import * as chrono from 'chrono-node'
import { NULL_DATE } from './constants'

export function isNullDate(date: string): boolean {
  return !date || date === NULL_DATE
}

export function isOverdue(date: string): boolean {
  if (isNullDate(date)) return false
  const d = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

export function isToday(date: string): boolean {
  if (isNullDate(date)) return false
  const d = new Date(date)
  const today = new Date()
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  )
}

export function isDueThisWeek(date: string): boolean {
  if (isNullDate(date)) return false
  const d = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()))
  endOfWeek.setHours(23, 59, 59, 999)
  return d >= today && d <= endOfWeek
}

export function formatRelativeDate(date: string): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'

  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  }

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function parseNaturalDate(text: string): Date | null {
  const results = chrono.parse(text)
  if (results.length === 0) return null
  return results[0].start.date()
}
