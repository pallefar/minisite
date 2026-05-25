import SwiftUI

// ContentView.swift — Root SwiftUI view for the LeanShot Watch App
// Phase 57 — WATCH-01 scaffold stub. Full UI deferred to Phase 70.

struct ContentView: View {
    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                Text("LeanShot")
                    .font(.headline)
                    .padding(.top)

                NavigationLink(destination: QuickLogView()) {
                    Label("Quick Log", systemImage: "syringe")
                        .font(.body)
                        .padding()
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
            }
            .padding()
            .navigationTitle("LeanShot")
        }
    }
}

#Preview {
    ContentView()
}
