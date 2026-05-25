import SwiftUI
import WidgetKit

// ComplicationViews.swift — SwiftUI views for the LeanShot Watch complication families
// Phase 57 — WATCH-01 scaffold stub.
// Uses WidgetKit accessory families (watchOS 9+). No ClockKit symbols.

// MARK: - Circular Complication (accessoryCircular)

struct ComplicationCircularView: View {
    let entry: ComplicationEntry

    var body: some View {
        switch WidgetFamily.accessoryCircular {
        default:
            VStack(spacing: 2) {
                if let nextDose = entry.nextDoseDate {
                    Text(nextDose, style: .relative)
                        .font(.system(size: 11, weight: .semibold))
                        .minimumScaleFactor(0.7)
                } else {
                    Image(systemName: "syringe")
                        .font(.title3)
                }
                Text("\(entry.currentStreak)w")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
        }
    }
}

// MARK: - Rectangular Complication (accessoryRectangular)

struct ComplicationRectangularView: View {
    let entry: ComplicationEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Image(systemName: "syringe")
                    .font(.caption2)
                if let nextDose = entry.nextDoseDate {
                    Text(nextDose, style: .relative)
                        .font(.caption2)
                        .lineLimit(1)
                } else {
                    Text("No schedule")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            Text("Streak: \(entry.currentStreak) weeks")
                .font(.caption2)
                .foregroundColor(.secondary)
            if let site = entry.nextSite {
                Text("Next: \(site)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 2)
    }
}

// MARK: - Inline Complication (accessoryInline)

struct ComplicationInlineView: View {
    let entry: ComplicationEntry

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "syringe")
            if let nextDose = entry.nextDoseDate {
                Text(nextDose, style: .relative)
            } else {
                Text("LeanShot")
            }
        }
        .font(.caption2)
    }
}

// MARK: - Previews

#Preview("Circular", as: .accessoryCircular) {
    LeanShotComplication()
} timeline: {
    ComplicationEntry(date: Date(), nextDoseDate: Date().addingTimeInterval(86400), currentStreak: 5, nextSite: "Abdomen UL")
}

#Preview("Rectangular", as: .accessoryRectangular) {
    LeanShotComplication()
} timeline: {
    ComplicationEntry(date: Date(), nextDoseDate: Date().addingTimeInterval(86400), currentStreak: 5, nextSite: "Abdomen UL")
}
