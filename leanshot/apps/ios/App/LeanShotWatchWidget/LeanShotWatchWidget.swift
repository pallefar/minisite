import WidgetKit
import SwiftUI

// LeanShotWatchWidget.swift — WidgetKit complication bundle for LeanShot Watch
// Phase 57 — WATCH-01 scaffold. App Group UserDefaults wiring deferred to Phase 70.
// Bundle ID: app.leanshot.ios.watchkitapp.widget
//
// Uses WidgetKit StaticConfiguration + SwiftUI (watchOS 9+).
// The deprecated ClockKit framework is NOT used anywhere in this target.

// MARK: - Timeline Provider

struct ComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(
            date: Date(),
            nextDoseDate: nil,
            currentStreak: 0,
            nextSite: nil
        )
    }

    func getSnapshot(
        in context: Context,
        completion: @escaping (ComplicationEntry) -> Void
    ) {
        completion(placeholder(in: context))
    }

    func getTimeline(
        in context: Context,
        completion: @escaping (Timeline<ComplicationEntry>) -> Void
    ) {
        // Phase 70: read from shared App Group UserDefaults populated by phone on
        // WatchConnectivity receipt. For scaffold: return placeholder entry with 15-min refresh.
        let entry = readEntryFromSharedDefaults()
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        let timeline = Timeline(entries: [entry], policy: .after(nextRefresh))
        completion(timeline)
    }

    /// Read complication data from shared UserDefaults (App Group).
    /// Phase 57 scaffold: returns placeholder values.
    /// Phase 70 will wire actual data written by the phone on WatchConnectivity receipt.
    private func readEntryFromSharedDefaults() -> ComplicationEntry {
        // App Group suite for watch Widget Extension ↔ Watch App communication.
        // NOTE: This is within-watch App Group (Widget ↔ Watch App on the same watch device).
        // Phone→Watch data crosses via WatchConnectivity, NOT shared UserDefaults (RESEARCH Pitfall 2).
        let defaults = UserDefaults(suiteName: "group.app.leanshot.ios.watchkitapp") ?? .standard
        let nextDoseTimestamp = defaults.double(forKey: "nextDoseTimestamp")
        let nextDoseDate = nextDoseTimestamp > 0 ? Date(timeIntervalSince1970: nextDoseTimestamp) : nil
        let streak = defaults.integer(forKey: "currentStreak")
        let site = defaults.string(forKey: "nextSite")
        return ComplicationEntry(
            date: Date(),
            nextDoseDate: nextDoseDate,
            currentStreak: streak,
            nextSite: site
        )
    }
}

// MARK: - Widget Configuration

struct LeanShotComplication: Widget {
    let kind = "app.leanshot.complication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ComplicationProvider()) { entry in
            ComplicationCircularView(entry: entry)
        }
        .configurationDisplayName("LeanShot")
        .description("Next dose + streak")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Widget Bundle Entry Point

@main
struct LeanShotWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        LeanShotComplication()
    }
}
