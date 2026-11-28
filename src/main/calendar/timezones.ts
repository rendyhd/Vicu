// Time zones a calendar names without defining them (contract 20.9: "the file's own time zones").
//
// ical.js knows no zone of its own beyond UTC: a TZID without a VTIMEZONE in the file is read as
// floating local time, so a meeting in New York would land at the same clock time here. Many files
// do that, and Outlook and Exchange name their zones the Windows way ("W. Europe Standard Time",
// sometimes the display name "(UTC+01:00) Amsterdam, Berlin, ..."). Before ical.js reads a file,
// every such TZID is mapped to an IANA zone (the table below for Windows names, the tail of a
// "/mozilla.org/.../Europe/Berlin" style id, or the IANA name itself) and a VTIMEZONE is built for
// it from the system's own zone data (Intl), then registered under the file's TZID.
// Free of Electron so it can be tested.

import ICAL from 'ical.js'

/** Windows zone ids (CLDR windowsZones, territory 001) for the zones calendars use most. */
const WINDOWS_ZONES: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Aleutian Standard Time': 'America/Adak',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Marquesas Standard Time': 'Pacific/Marquesas',
  'Alaskan Standard Time': 'America/Anchorage',
  'UTC-09': 'Etc/GMT+9',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'UTC-08': 'Etc/GMT+8',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Mountain Standard Time': 'America/Denver',
  'Yukon Standard Time': 'America/Whitehorse',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Easter Island Standard Time': 'Pacific/Easter',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'Eastern Standard Time': 'America/New_York',
  'Haiti Standard Time': 'America/Port-au-Prince',
  'Cuba Standard Time': 'America/Havana',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Turks And Caicos Standard Time': 'America/Grand_Turk',
  'Paraguay Standard Time': 'America/Asuncion',
  'Atlantic Standard Time': 'America/Halifax',
  'Venezuela Standard Time': 'America/Caracas',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Tocantins Standard Time': 'America/Araguaina',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'Greenland Standard Time': 'America/Nuuk',
  'Montevideo Standard Time': 'America/Montevideo',
  'Magallanes Standard Time': 'America/Punta_Arenas',
  'Saint Pierre Standard Time': 'America/Miquelon',
  'Bahia Standard Time': 'America/Bahia',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'Etc/UTC',
  'Coordinated Universal Time': 'Etc/UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Sao Tome Standard Time': 'Africa/Sao_Tome',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Jordan Standard Time': 'Asia/Amman',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Syria Standard Time': 'Asia/Damascus',
  'West Bank Standard Time': 'Asia/Hebron',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kyiv',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Sudan Standard Time': 'Africa/Juba',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Sudan Standard Time': 'Africa/Khartoum',
  'Libya Standard Time': 'Africa/Tripoli',
  'Namibia Standard Time': 'Africa/Windhoek',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Volgograd Standard Time': 'Europe/Volgograd',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Astrakhan Standard Time': 'Europe/Astrakhan',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Russia Time Zone 3': 'Europe/Samara',
  'Mauritius Standard Time': 'Indian/Mauritius',
  'Saratov Standard Time': 'Europe/Saratov',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pakistan Standard Time': 'Asia/Karachi',
  'Qyzylorda Standard Time': 'Asia/Qyzylorda',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Omsk Standard Time': 'Asia/Omsk',
  'Myanmar Standard Time': 'Asia/Yangon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Altai Standard Time': 'Asia/Barnaul',
  'W. Mongolia Standard Time': 'Asia/Hovd',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'Tomsk Standard Time': 'Asia/Tomsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Aus Central W. Standard Time': 'Australia/Eucla',
  'Transbaikal Standard Time': 'Asia/Chita',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'North Korea Standard Time': 'Asia/Pyongyang',
  'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Lord Howe Standard Time': 'Australia/Lord_Howe',
  'Bougainville Standard Time': 'Pacific/Bougainville',
  'Russia Time Zone 10': 'Asia/Srednekolymsk',
  'Magadan Standard Time': 'Asia/Magadan',
  'Norfolk Standard Time': 'Pacific/Norfolk',
  'Sakhalin Standard Time': 'Asia/Sakhalin',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'Russia Time Zone 11': 'Asia/Kamchatka',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'UTC+12': 'Etc/GMT-12',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Chatham Islands Standard Time': 'Pacific/Chatham',
  'UTC+13': 'Etc/GMT-13',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
  'Line Islands Standard Time': 'Pacific/Kiritimati',
}

/**
 * Outlook's display names ("(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna"), by a
 * phrase of the city list, for the zones that turn up in exported files most.
 */
const DISPLAY_NAMES: [RegExp, string][] = [
  [/Amsterdam, Berlin/i, 'Europe/Berlin'],
  [/Brussels, Copenhagen, Madrid, Paris/i, 'Europe/Paris'],
  [/Belgrade, Bratislava, Budapest/i, 'Europe/Budapest'],
  [/Sarajevo, Skopje, Warsaw/i, 'Europe/Warsaw'],
  [/Dublin, Edinburgh, Lisbon, London/i, 'Europe/London'],
  [/Athens, Bucharest/i, 'Europe/Bucharest'],
  [/Helsinki, Kyiv|Helsinki, Kiev/i, 'Europe/Kyiv'],
  [/Moscow, St\.? Petersburg/i, 'Europe/Moscow'],
  [/Eastern Time \(US (?:&|and) Canada\)/i, 'America/New_York'],
  [/Central Time \(US (?:&|and) Canada\)/i, 'America/Chicago'],
  [/Mountain Time \(US (?:&|and) Canada\)/i, 'America/Denver'],
  [/Pacific Time \(US (?:&|and) Canada\)/i, 'America/Los_Angeles'],
  [/Canberra, Melbourne, Sydney/i, 'Australia/Sydney'],
  [/Auckland, Wellington/i, 'Pacific/Auckland'],
  [/Osaka, Sapporo, Tokyo/i, 'Asia/Tokyo'],
  [/Beijing, Chongqing, Hong Kong/i, 'Asia/Shanghai'],
  [/Chennai, Kolkata, Mumbai/i, 'Asia/Kolkata'],
  [/Coordinated Universal Time|^\(UTC\) /i, 'Etc/UTC'],
]

function isIanaZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

/** The IANA zone a TZID means, or null when it is none Vicu knows. */
export function ianaZoneFor(tzid: string): string | null {
  const id = tzid.trim().replace(/^"|"$/g, '')
  if (!id) return null
  const windows = WINDOWS_ZONES[id]
  if (windows) return windows
  for (const [pattern, zone] of DISPLAY_NAMES) if (pattern.test(id)) return zone
  // "/mozilla.org/20050126_1/Europe/Berlin", "/freeassociation.sourceforge.net/Tzfile/Europe/Berlin".
  const parts = id.split('/').filter(Boolean)
  for (let take = Math.min(3, parts.length); take >= 1; take--) {
    const tail = parts.slice(-take).join('/')
    if (/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$|^UTC$|^GMT$/.test(tail) && isIanaZone(tail)) return tail
  }
  return null
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** Minutes the zone is ahead of UTC at `ms`. */
function offsetAt(zone: string, ms: number): number {
  let format = formatters.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, format)
  }
  const at = Math.floor(ms / 1000) * 1000
  const values: Record<string, number> = {}
  for (const part of format.formatToParts(at)) if (part.type !== 'literal') values[part.type] = Number(part.value)
  const wall = Date.UTC(values.year, values.month - 1, values.day, values.hour % 24, values.minute, values.second)
  return Math.round((wall - at) / 60_000)
}

const FIRST_YEAR = 1970
const LAST_YEAR = 2050
const WEEK = 7 * 24 * 3600_000

/** The instants (UTC ms, to the minute) where the zone's offset changes, with the offsets. */
function transitions(zone: string): { at: number; from: number; to: number }[] {
  const out: { at: number; from: number; to: number }[] = []
  const end = Date.UTC(LAST_YEAR, 0, 1)
  let t = Date.UTC(FIRST_YEAR, 0, 1)
  let offset = offsetAt(zone, t)
  while (t < end) {
    const next = Math.min(t + WEEK, end)
    const nextOffset = offsetAt(zone, next)
    if (nextOffset !== offset) {
      // The change is in (t, next]: halve down to the minute.
      let lo = t
      let hi = next
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000
        if (offsetAt(zone, mid) === offset) lo = mid
        else hi = mid
      }
      out.push({ at: hi, from: offset, to: nextOffset })
      offset = nextOffset
    }
    t = next
  }
  return out
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
}

/** A wall-clock time as iCalendar writes it: the UTC fields of ms shifted by the offset. */
function wallText(ms: number, offset: number): string {
  const d = new Date(ms + offset * 60_000)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

/** A VTIMEZONE for `tzid` with the rules of the IANA zone, from 1970 to 2050. */
export function vtimezoneFromIana(tzid: string, zone: string): string {
  const first = offsetAt(zone, Date.UTC(FIRST_YEAR, 0, 1))
  const lines = [
    'BEGIN:VTIMEZONE',
    `TZID:${tzid}`,
    'BEGIN:STANDARD',
    `DTSTART:${FIRST_YEAR}0101T000000`,
    `TZOFFSETFROM:${offsetText(first)}`,
    `TZOFFSETTO:${offsetText(first)}`,
    'END:STANDARD',
  ]
  for (const change of transitions(zone)) {
    const kind = change.to > change.from ? 'DAYLIGHT' : 'STANDARD'
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:${wallText(change.at, change.from)}`,
      `TZOFFSETFROM:${offsetText(change.from)}`,
      `TZOFFSETTO:${offsetText(change.to)}`,
      `END:${kind}`,
    )
  }
  lines.push('END:VTIMEZONE')
  return lines.join('\r\n')
}

/** Every TZID parameter a file uses, unquoted. */
export function tzidsIn(text: string): Set<string> {
  const ids = new Set<string>()
  for (const match of text.matchAll(/;TZID=(?:"([^"]*)"|([^;:\r\n]*))/gi)) {
    const id = (match[1] ?? match[2] ?? '').trim()
    if (id) ids.add(id)
  }
  return ids
}

/**
 * Register a zone for every TZID of `text` that neither the file (`defined`) nor ical.js knows,
 * when Vicu can tell which zone it means. One that it cannot stays floating, as before.
 */
export function registerMissingZones(text: string, defined: ReadonlySet<string>): void {
  for (const tzid of tzidsIn(text)) {
    if (defined.has(tzid) || ICAL.TimezoneService.has(tzid)) continue
    const zone = ianaZoneFor(tzid)
    if (!zone) continue
    const component = new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${vtimezoneFromIana(tzid, zone)}\r\nEND:VCALENDAR`))
    const timezone = new ICAL.Timezone(component.getFirstSubcomponent('vtimezone')!)
    ICAL.TimezoneService.register(timezone)
  }
}
