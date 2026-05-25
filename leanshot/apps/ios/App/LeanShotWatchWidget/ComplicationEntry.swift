import WidgetKit

// ComplicationEntry.swift — TimelineEntry for the LeanShot Watch complication
// Phase 57 — WATCH-01 scaffold. Data populated from phone via WatchConnectivity (Phase 70).
// Bundle ID: app.leanshot.ios.watchkitapp.widget
//
// Field names mirror the TypeScript WatchComplicationData interface in
// src/lib/watch/complication-data.ts (produced by watchComplicationData()).
// NOTE: Uses WidgetKit (NOT ClockKit — deprecated in watchOS 9).

struct ComplicationEntry: TimelineEntry {
    /// Required by TimelineEntry — the date/time for this entry.
    let date: Date

    /// Next scheduled dose date, nil if no schedule set.
    let nextDoseDate: Date?

    /// Current injection-day streak (consecutive weeks with a dose).
    let currentStreak: Int

    /// Recommended next injection site label (e.g. "Abdomen UL"), nil if none.
    let nextSite: String?
}
