// Vicu's calendar helper for macOS: reads the calendars of this Mac through EventKit (everything
// added in System Settings, Internet Accounts: iCloud, Google, Exchange, CalDAV) for the Plan
// screen. Read-only: it never creates, changes or deletes an event or a calendar. The main process
// starts it (src/main/calendar/eventkit-helper.ts) and talks to it over stdin and stdout, one JSON
// object per line. Contract: docs/cross-app-semantics-v1.md 20.9.
//
// stdin, one request per line, each with an "id" the answer repeats:
//   {"id":1,"cmd":"status"}                                    the authorization, never asks
//   {"id":2,"cmd":"request"}                                   asks for full access (macOS 14+),
//                                                              requestAccess(to:) before that
//   {"id":3,"cmd":"calendars"}                                 the event calendars
//   {"id":4,"cmd":"events","calendarIds":["..."],"from":ms,"to":ms}
//                                                              the occurrences in [from, to)
//   {"id":5,"cmd":"watch"}                                     then {"type":"changed"} lines
// stdout:
//   {"id":1,"ok":true,"status":"full"}                         status: full | write-only | denied |
//                                                              restricted | not-determined | unknown
//   {"id":3,"ok":true,"calendars":[{"id","title","color","source","sourceType","type"}]}
//   {"id":4,"ok":true,"events":[...],"missing":["calendar id"],"truncated":false}
//   {"id":n,"ok":false,"code":"denied|bad-request|failed","message":"..."}
//   {"type":"changed"}                                         EKEventStoreChanged (after "watch")
// An event: {"key","calendarId","title","location","start","end","allDay","availability",
//   "status","self"} with start and end in ms; availability busy | free | tentative | unavailable |
//   not-supported; status none | confirmed | tentative | canceled; self is the user's own
//   participant status (pending | accepted | declined | tentative | ...), absent when the user is
//   not an attendee. Cancelled events and events the user declined are left out here.
// End of stdin ends the helper, so it never outlives the app.
//
// Build: node scripts/build-calendar-helper.mjs (swiftc, with Info.plist linked in for the usage
// strings macOS shows when it asks for the calendars).

import CoreGraphics
import EventKit
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let outputLock = NSLock()

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    outputLock.unlock()
}

func answer(_ id: Any, _ fields: [String: Any]) {
    var object = fields
    object["id"] = id
    object["ok"] = true
    emit(object)
}

func refuse(_ id: Any, _ code: String, _ message: String) {
    emit(["id": id, "ok": false, "code": code, "message": message])
}

/// Every store call runs here, one at a time.
let work = DispatchQueue(label: "com.rendyhd.vicu.calendar.work")
var store = EKEventStore()
var watching = false

func accessName() -> String {
    // Raw values, so the names of macOS 14 (fullAccess, writeOnly) and before (authorized) agree.
    switch EKEventStore.authorizationStatus(for: .event).rawValue {
    case 0: return "not-determined"
    case 1: return "restricted"
    case 2: return "denied"
    case 3: return "full"
    case 4: return "write-only"
    default: return "unknown"
    }
}

func hexColor(_ color: CGColor?) -> String? {
    guard let color = color,
          let space = CGColorSpace(name: CGColorSpace.sRGB),
          let srgb = color.converted(to: space, intent: .defaultIntent, options: nil),
          let parts = srgb.components, parts.count >= 3 else { return nil }
    let channel = { (value: CGFloat) -> Int in max(0, min(255, Int((value * 255).rounded()))) }
    return String(format: "#%02x%02x%02x", channel(parts[0]), channel(parts[1]), channel(parts[2]))
}

func sourceTypeName(_ type: EKSourceType) -> String {
    switch type {
    case .local: return "local"
    case .exchange: return "exchange"
    case .calDAV: return "caldav"
    case .mobileMe: return "icloud"
    case .subscribed: return "subscribed"
    case .birthdays: return "birthdays"
    @unknown default: return "other"
    }
}

func calendarTypeName(_ type: EKCalendarType) -> String {
    switch type {
    case .local: return "local"
    case .calDAV: return "caldav"
    case .exchange: return "exchange"
    case .subscription: return "subscription"
    case .birthday: return "birthday"
    @unknown default: return "other"
    }
}

func availabilityName(_ availability: EKEventAvailability) -> String {
    switch availability {
    case .busy: return "busy"
    case .free: return "free"
    case .tentative: return "tentative"
    case .unavailable: return "unavailable"
    case .notSupported: return "not-supported"
    @unknown default: return "busy"
    }
}

func statusName(_ status: EKEventStatus) -> String {
    switch status {
    case .none: return "none"
    case .confirmed: return "confirmed"
    case .tentative: return "tentative"
    case .canceled: return "canceled"
    @unknown default: return "none"
    }
}

func participantName(_ status: EKParticipantStatus) -> String {
    switch status {
    case .pending: return "pending"
    case .accepted: return "accepted"
    case .declined: return "declined"
    case .tentative: return "tentative"
    case .delegated: return "delegated"
    case .completed: return "completed"
    case .inProcess: return "in-process"
    case .unknown: return "unknown"
    @unknown default: return "unknown"
    }
}

func millis(_ date: Date) -> Double {
    return (date.timeIntervalSince1970 * 1000).rounded()
}

let deniedMessage = "Vicu may not read your calendars. Allow it in System Settings, Privacy & Security, Calendars."

func canRead() -> Bool {
    return accessName() == "full"
}

func listCalendars(_ id: Any) {
    guard canRead() else { return refuse(id, "denied", deniedMessage) }
    let calendars = store.calendars(for: .event).map { calendar -> [String: Any] in
        var item: [String: Any] = [
            "id": calendar.calendarIdentifier,
            "title": calendar.title,
            "type": calendarTypeName(calendar.type),
        ]
        if let color = hexColor(calendar.cgColor) { item["color"] = color }
        if let source = calendar.source {
            item["source"] = source.title
            item["sourceType"] = sourceTypeName(source.sourceType)
        }
        return item
    }
    answer(id, ["calendars": calendars])
}

/// At most this many occurrences in one answer; main refuses far fewer.
let maxEvents = 20000

func listEvents(_ id: Any, _ request: [String: Any]) {
    guard canRead() else { return refuse(id, "denied", deniedMessage) }
    guard let ids = request["calendarIds"] as? [String],
          let from = (request["from"] as? NSNumber)?.doubleValue,
          let to = (request["to"] as? NSNumber)?.doubleValue, to > from else {
        return refuse(id, "bad-request", "An events request needs calendarIds, from and to.")
    }
    var calendars: [EKCalendar] = []
    var missing: [String] = []
    for calendarId in ids {
        if let calendar = store.calendar(withIdentifier: calendarId), calendar.allowedEntityTypes.contains(.event) {
            calendars.append(calendar)
        } else {
            missing.append(calendarId)
        }
    }
    // An empty list would mean every calendar to EventKit.
    if calendars.isEmpty { return answer(id, ["events": [], "missing": missing, "truncated": false]) }

    var events: [[String: Any]] = []
    var truncated = false
    // EventKit reads at most four years per predicate; Vicu asks for weeks, but stay inside it.
    let span: TimeInterval = 3 * 365 * 24 * 3600
    var start = Date(timeIntervalSince1970: from / 1000)
    let end = Date(timeIntervalSince1970: to / 1000)
    var seen = Set<String>()
    while start < end && !truncated {
        let chunkEnd = min(end, start.addingTimeInterval(span))
        let predicate = store.predicateForEvents(withStart: start, end: chunkEnd, calendars: calendars)
        for event in store.events(matching: predicate) {
            if event.status == .canceled { continue }
            let me = event.attendees?.first(where: { $0.isCurrentUser })
            if me?.participantStatus == .declined { continue }
            let occurrence = event.occurrenceDate ?? event.startDate ?? Date(timeIntervalSince1970: 0)
            let base = event.eventIdentifier ?? event.calendarItemIdentifier
            let key = "\(base)|\(Int64(millis(occurrence)))"
            if seen.contains(key) { continue }
            seen.insert(key)
            var item: [String: Any] = [
                "key": key,
                "calendarId": event.calendar?.calendarIdentifier ?? "",
                "title": event.title ?? "",
                "start": millis(event.startDate),
                "end": millis(event.endDate ?? event.startDate),
                "allDay": event.isAllDay,
                "availability": availabilityName(event.availability),
                "status": statusName(event.status),
            ]
            if let location = event.location, !location.isEmpty { item["location"] = location }
            if let me = me { item["self"] = participantName(me.participantStatus) }
            events.append(item)
            if events.count >= maxEvents { truncated = true; break }
        }
        start = chunkEnd
    }
    answer(id, ["events": events, "missing": missing, "truncated": truncated])
}

func requestAccess(_ id: Any) {
    let done: (Bool, Error?) -> Void = { _, _ in
        work.async {
            // A store made before the answer may not see the calendars; start a fresh one.
            store = EKEventStore()
            answer(id, ["status": accessName()])
        }
    }
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents(completion: done)
    } else {
        store.requestAccess(to: .event, completion: done)
    }
}

func startWatching(_ id: Any) {
    if !watching {
        watching = true
        // Any store: the one in use is replaced after a permission answer.
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: nil, queue: nil) { _ in
            emit(["type": "changed"])
        }
    }
    answer(id, ["watching": true])
}

func handle(_ line: String) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return }
    guard let data = trimmed.data(using: .utf8),
          let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        return refuse(NSNull(), "bad-request", "Not a JSON request.")
    }
    let id: Any = request["id"] ?? NSNull()
    switch request["cmd"] as? String {
    case "status": answer(id, ["status": accessName()])
    case "request":
        if accessName() == "not-determined" { requestAccess(id) } else { answer(id, ["status": accessName()]) }
    case "calendars": listCalendars(id)
    case "events": listEvents(id, request)
    case "watch": startWatching(id)
    default: refuse(id, "bad-request", "Unknown command.")
    }
}

DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        work.sync { handle(line) }
    }
    // End of stdin: the app has gone.
    exit(0)
}

// The main run loop delivers EventKit's notifications.
dispatchMain()
