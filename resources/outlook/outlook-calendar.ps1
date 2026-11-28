# Vicu: read the calendars of classic Outlook on this PC (src/main/calendar/outlook.ts runs this).
#
# Read-only, and only while Outlook is already open: it attaches to the running Outlook and never
# starts it. It reads only the fields Vicu shows (subject, place, times, show-as, meeting status and
# your own answer); it does not touch the organizer, attendees or the body, which Outlook guards with
# its "a program is trying to access" prompt. One JSON object on standard output.
#
#   -Command status                          { state: missing | closed | running }
#   -Command calendars                       { calendars: [{ id, name, account }] } or { error }
#   -Command events -Ids a,b -From ms -To ms { events: [...], missing: [...], truncated } or { error }

param(
  [string]$Command = 'status',
  [string]$Ids = '',
  [long]$From = 0,
  [long]$To = 0,
  [int]$Max = 5000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Answer($value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Depth 6 -Compress))
}

function Get-RunningOutlook {
  try { return [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { return $null }
}

if ($Command -eq 'status') {
  if (-not [Type]::GetTypeFromProgID('Outlook.Application')) { Write-Answer @{ state = 'missing' }; exit 0 }
  if (Get-RunningOutlook) { Write-Answer @{ state = 'running' } } else { Write-Answer @{ state = 'closed' } }
  exit 0
}

$outlook = Get-RunningOutlook
if (-not $outlook) {
  if (-not [Type]::GetTypeFromProgID('Outlook.Application')) { Write-Answer @{ error = 'missing' } } else { Write-Answer @{ error = 'closed' } }
  exit 0
}

try {
  $session = $outlook.GetNamespace('MAPI')

  if ($Command -eq 'calendars') {
    $found = New-Object System.Collections.ArrayList
    $walk = $null
    $walk = {
      param($folder, $account, $depth)
      # 1 = olAppointmentItem: a calendar folder.
      if ($folder.DefaultItemType -eq 1) { [void]$found.Add(@{ id = $folder.EntryID; name = [string]$folder.Name; account = $account }) }
      if ($depth -lt 3) { foreach ($sub in $folder.Folders) { & $walk $sub $account ($depth + 1) } }
    }
    foreach ($store in $session.Stores) {
      $calendar = $null
      # 9 = olFolderCalendar; a store without one (public folders, an archive) is skipped.
      try { $calendar = $store.GetDefaultFolder(9) } catch { continue }
      if ($calendar) { & $walk $calendar ([string]$store.DisplayName) 0 }
    }
    Write-Answer @{ calendars = @($found) }
    exit 0
  }

  if ($Command -eq 'events') {
    $fromLocal = [DateTimeOffset]::FromUnixTimeMilliseconds($From).LocalDateTime
    $toLocal = [DateTimeOffset]::FromUnixTimeMilliseconds($To).LocalDateTime
    $events = New-Object System.Collections.ArrayList
    $missing = New-Object System.Collections.ArrayList
    $truncated = $false
    foreach ($id in ($Ids -split ',' | Where-Object { $_ })) {
      $folder = $null
      try { $folder = $session.GetFolderFromID($id) } catch { [void]$missing.Add($id); continue }
      $items = $folder.Items
      # Sorted by start with recurrences included, then restricted to the window (Outlook's own
      # documented order). Restrict takes the date in this PC's short format.
      $items.Sort('[Start]')
      $items.IncludeRecurrences = $true
      $filter = "[Start] < '" + $toLocal.ToString('g') + "' AND [End] > '" + $fromLocal.ToString('g') + "'"
      $inWindow = $items.Restrict($filter)
      $item = $inWindow.GetFirst()
      while ($null -ne $item) {
        if ($events.Count -ge $Max) { $truncated = $true; break }
        # 26 = olAppointment (a meeting request or a note in the folder is skipped).
        if ($item.Class -eq 26) {
          $start = [DateTimeOffset]::new([DateTime]::SpecifyKind($item.StartUTC, [DateTimeKind]::Utc)).ToUnixTimeMilliseconds()
          $end = [DateTimeOffset]::new([DateTime]::SpecifyKind($item.EndUTC, [DateTimeKind]::Utc)).ToUnixTimeMilliseconds()
          if ($end -gt $From -and $start -lt $To) {
            $uid = [string]$item.GlobalAppointmentID
            if (-not $uid) { $uid = [string]$item.EntryID }
            [void]$events.Add(@{
              key = "$uid/$start"
              calendarId = $id
              title = [string]$item.Subject
              location = [string]$item.Location
              start = $start
              end = $end
              allDay = [bool]$item.AllDayEvent
              busy = [int]$item.BusyStatus
              meeting = [int]$item.MeetingStatus
              response = [int]$item.ResponseStatus
            })
          }
        }
        $item = $inWindow.GetNext()
      }
      if ($truncated) { break }
    }
    Write-Answer @{ events = @($events); missing = @($missing); truncated = $truncated }
    exit 0
  }

  Write-Answer @{ error = 'unknown-command' }
} catch {
  Write-Answer @{ error = 'failed'; message = [string]$_.Exception.Message }
}
