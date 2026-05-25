import SwiftUI
import WatchConnectivity

// LeanShotWatchApp.swift — watchOS 7+ SwiftUI lifecycle (@main, NOT WKExtensionDelegate)
// Bundle ID: app.leanshot.ios.watchkitapp
// Phase 57 — WATCH-01 scaffold. On-device build deferred to Phase 70.

@main
struct LeanShotWatchApp: App {
    init() {
        WatchConnectivityManager.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
