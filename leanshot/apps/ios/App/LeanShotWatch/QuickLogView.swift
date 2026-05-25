import SwiftUI

// QuickLogView.swift — Quick dose-log screen for the LeanShot Watch App
// Phase 57 — WATCH-01 scaffold stub. Full dose-selection UI deferred to Phase 70.
//
// SECURITY: The watch payload MUST NOT include user_id — it is stamped
// by the phone-side dedupeAndMerge() from the authenticated session (T-57-AUTH).
// Watch relays through the phone via WatchConnectivity only (T-57-AUTH).

struct QuickLogView: View {
    @State private var isLogged = false

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: isLogged ? "checkmark.circle.fill" : "syringe")
                .font(.largeTitle)
                .foregroundColor(isLogged ? .green : .accentColor)

            Text(isLogged ? "Logged!" : "Log Dose")
                .font(.headline)

            if !isLogged {
                Button(action: sendQuickLog) {
                    Text("Log")
                        .font(.body)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                }
            }
        }
        .padding()
        .navigationTitle("Quick Log")
    }

    private func sendQuickLog() {
        // Stub payload — source is always "apple_watch"; user_id stamped phone-side.
        // Keys match WatchQueuedLog TS interface in src/lib/watch/sync-contract.ts.
        let now = ISO8601DateFormatter().string(from: Date())
        let payload: [String: Any] = [
            "deduped_id": makeStubDedupedId(source: "apple_watch", datetime: now),
            "datetime": now,
            "dose": "0.5",
            "unit": "mg",
            "site": NSNull(),   // site selection UI deferred to Phase 70
            "source": "apple_watch"
            // NOTE: user_id intentionally omitted — phone stamps it on receipt (T-57-AUTH)
        ]
        WatchConnectivityManager.shared.sendQueuedLog(payload)
        isLogged = true
    }

    // Minimal stub dedupe ID for the scaffold — full algorithm lives in TS sync-contract.ts.
    private func makeStubDedupedId(source: String, datetime: String) -> String {
        return "\(source):\(datetime)".data(using: .utf8)
            .flatMap { data -> String? in
                var bytes = [UInt8](repeating: 0, count: 16)
                let ns: [UInt8] = [0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1,
                                   0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8]
                for i in 0..<16 { bytes[i] = ns[i] }
                for (i, byte) in data.enumerated() {
                    bytes[i % 16] ^= byte
                }
                bytes[6] = (bytes[6] & 0x0f) | 0x50
                bytes[8] = (bytes[8] & 0x3f) | 0x80
                let hex = bytes.map { String(format: "%02x", $0) }.joined()
                let s = hex.startIndex
                return [
                    String(hex[s..<hex.index(s, offsetBy: 8)]),
                    String(hex[hex.index(s, offsetBy: 8)..<hex.index(s, offsetBy: 12)]),
                    String(hex[hex.index(s, offsetBy: 12)..<hex.index(s, offsetBy: 16)]),
                    String(hex[hex.index(s, offsetBy: 16)..<hex.index(s, offsetBy: 20)]),
                    String(hex[hex.index(s, offsetBy: 20)...])
                ].joined(separator: "-")
            } ?? UUID().uuidString
    }
}

#Preview {
    QuickLogView()
}
