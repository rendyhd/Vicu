// The browser link's native-messaging host on macOS (review 2026-11-13, S-4).
//
// A browser starts this tool for the Vicu extension (extensions/browser) and writes messages to
// its standard input. It does the job of resources/native-messaging-host/vicu-bridge.js, which
// Windows and Linux still run with the app binary as Node; on macOS the app no longer runs as
// Node (the RunAsNode fuse is off, scripts/electron-fuses.mjs), so the host is this small tool.
//
// Protocol (the same as vicu-bridge.js; pinned for both by
// src/main/__tests__/browser-bridge-protocol.test.ts):
//   in    stdin, one frame after another: a 4-byte unsigned length in the machine's byte order
//         (little-endian on every Mac), then that many bytes of UTF-8 JSON.
//         {"type":"tab","url":"...","title":"..."}  write the context file
//         {"type":"clear"}                           delete it
//         anything else, JSON that does not parse     ignored
//   out   nothing is ever written to stdout (the browser reads stdout as frames).
//   file  <userData>/browser-context.json = {"url","title","timestamp"} with the time in
//         milliseconds since 1970, written to a temporary file and renamed. The app reads it when
//         Quick Entry opens and ignores one older than 3 s (src/main/browser-client.ts), which is
//         why the extension sends the tab again every 2 s.
//   end   stdin closed: delete the file, exit 0. A read error: delete the file, exit 1.
//
// <userData> is ~/Library/Application Support/vicu, or VICU_USER_DATA_DIR when that is an absolute
// path: the same throwaway-profile override the app itself honours, so a test profile and its
// bridge agree. The tool takes no arguments (a browser passes the extension's origin; it is not
// read), loads no code, and reads nothing but stdin.
//
// Built by scripts/build-bridge-helper.mjs (npm run bridge:helper) into
// resources/bridge/vicu-bridge-macos and signed with the app.

import Foundation

/// A frame longer than this is not a tab message Vicu can use (a `data:` address of several
/// megabytes): its bytes are skipped without being kept, and the context is cleared, because the
/// tab on screen is no longer the one in the file.
let maxFrameBytes = 1 << 20

func contextFileURL() -> URL {
    if let override = ProcessInfo.processInfo.environment["VICU_USER_DATA_DIR"], override.hasPrefix("/") {
        return URL(fileURLWithPath: override, isDirectory: true).appendingPathComponent("browser-context.json")
    }
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        ?? URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true).appendingPathComponent("Library/Application Support", isDirectory: true)
    return support.appendingPathComponent("vicu", isDirectory: true).appendingPathComponent("browser-context.json")
}

let contextFile = contextFileURL()

func deleteContext() {
    try? FileManager.default.removeItem(at: contextFile)
}

func writeContext(url: String, title: String) {
    let payload: [String: Any] = [
        "url": url,
        "title": title,
        "timestamp": Int64((Date().timeIntervalSince1970 * 1000).rounded()),
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.withoutEscapingSlashes]) else { return }
    try? FileManager.default.createDirectory(at: contextFile.deletingLastPathComponent(), withIntermediateDirectories: true)
    // .atomic writes a temporary file beside it and renames, so the app never reads half a file.
    try? data.write(to: contextFile, options: [.atomic])
}

func handle(_ frame: [UInt8]) {
    guard let object = try? JSONSerialization.jsonObject(with: Data(frame), options: []),
          let message = object as? [String: Any],
          let type = message["type"] as? String else { return }
    if type == "tab" {
        guard let url = message["url"] as? String, !url.isEmpty else { return }
        writeContext(url: url, title: message["title"] as? String ?? "")
    } else if type == "clear" {
        deleteContext()
    }
}

var pending: [UInt8] = []
/// Bytes of an oversized frame still to be thrown away.
var skip = 0

func consume() {
    var offset = 0
    while true {
        if skip > 0 {
            let dropped = min(skip, pending.count - offset)
            offset += dropped
            skip -= dropped
            if skip > 0 { break }
        }
        guard pending.count - offset >= 4 else { break }
        let length = Int(pending[offset])
            | Int(pending[offset + 1]) << 8
            | Int(pending[offset + 2]) << 16
            | Int(pending[offset + 3]) << 24
        if length > maxFrameBytes {
            offset += 4
            skip = length
            deleteContext()
            continue
        }
        guard pending.count - offset >= 4 + length else { break }
        handle(Array(pending[(offset + 4)..<(offset + 4 + length)]))
        offset += 4 + length
    }
    if offset > 0 { pending.removeFirst(offset) }
}

var chunk = [UInt8](repeating: 0, count: 65536)
while true {
    let count = chunk.withUnsafeMutableBytes { read(STDIN_FILENO, $0.baseAddress, $0.count) }
    if count > 0 {
        pending.append(contentsOf: chunk[0..<count])
        consume()
    } else if count == 0 {
        deleteContext()
        exit(0)
    } else if errno != EINTR {
        deleteContext()
        exit(1)
    }
}
