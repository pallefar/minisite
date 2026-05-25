package app.leanshot.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text

/**
 * WearMainActivity — root Compose activity for the LeanShot Wear OS companion.
 *
 * SCAFFOLD ONLY. On-device rendering deferred to Phase 70 per CONTEXT D-08.
 *
 * Architecture:
 *   - Displays next-dose + streak data received from the phone via WatchDataLayerService.
 *   - All data originates on the phone (authenticated session) — never calls backend directly.
 *   - Quick-log tap navigates to QuickLogActivity, which relays via DataClient.putDataItem.
 */
class WearMainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            LeanShotWearApp()
        }
    }
}

@Composable
private fun LeanShotWearApp() {
    MaterialTheme {
        // TODO Phase 70: Replace with real complication data from DataLayer (nextDose, streak, nextSite).
        // Data flows: phone stamps user_id → WatchDataLayerService.onDataChanged → local DataMap → here.
        Text(text = "LeanShot")
    }
}
