import WatchConnectivity

// WatchConnectivityManager.swift — WCSession wrapper for the LeanShot Watch App
// Phase 57 — WATCH-01 scaffold. Phone-side handler wired in Phase 70.
//
// SECURITY INVARIANTS (T-57-AUTH, T-57-LOSS):
//   1. Use transferUserInfo() only — FIFO, OS-queued, guaranteed delivery even offline.
//      The alternative realtime API requires foreground reachability and risks data loss.
//   2. NEVER include user_id in the watch payload — stamped by phone-side dedupeAndMerge()
//      from the authenticated session (T-57-AUTH).
//   3. No backend framework imports — all writes relay through the phone only.

class WatchConnectivityManager: NSObject, WCSessionDelegate {
    static let shared = WatchConnectivityManager()
    private let session = WCSession.default

    private override init() {
        super.init()
    }

    // MARK: - Activation

    /// Call once at app launch (from LeanShotWatchApp.init).
    func activate() {
        guard WCSession.isSupported() else { return }
        session.delegate = self
        session.activate()
    }

    // MARK: - Offline-Tolerant Log Relay

    /// Send a quick-log payload to the phone using transferUserInfo (offline-tolerant).
    /// The OS queues payloads FIFO and delivers them when the phone is reachable.
    /// transferUserInfo is the ONLY method used for dose-log relay (T-57-LOSS mitigation).
    func sendQueuedLog(_ log: [String: Any]) {
        session.transferUserInfo(log)
    }

    // MARK: - WCSessionDelegate (required stubs)

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        // Activation complete — no-op for scaffold; error surfacing deferred to Phase 70.
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        // Phone-originated updates (e.g. complication data refresh) — no-op for scaffold.
        // Phase 70 will wire complication data into shared UserDefaults here.
    }
}
