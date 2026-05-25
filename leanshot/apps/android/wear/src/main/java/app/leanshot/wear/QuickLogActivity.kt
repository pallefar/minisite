package app.leanshot.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import java.time.Instant

/**
 * QuickLogActivity — quick dose-log entry point on the Wear OS companion.
 *
 * SCAFFOLD ONLY. On-device interaction and real data-entry deferred to Phase 70.
 *
 * Security contract (T-57-AUTH):
 *   - The watch payload NEVER includes user_id. The phone stamps it from its authenticated session.
 *   - No direct backend calls. The log relays through the phone via DataClient.putDataItem (T-57-LOSS).
 *
 * Payload shape mirrors TS WatchQueuedLog in src/lib/watch/sync-contract.ts:
 *   { deduped_id, datetime, dose, unit, site, source="wear_os" }
 *   user_id is intentionally absent — stamped phone-side by dedupeAndMerge().
 */
class QuickLogActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            QuickLogScreen(
                onLog = { sendQuickLog() }
            )
        }
    }

    private fun sendQuickLog() {
        // TODO Phase 70: Read actual dose/unit/site from UI state before building the payload.
        // Payload keys must match the TS WatchQueuedLog interface (sync-contract.ts) exactly.
        val datetime = Instant.now().toString()
        val logMap = mapOf(
            "deduped_id" to WatchDataLayerService.makeDedupedId("wear_os", datetime),
            "datetime" to datetime,
            "dose" to "0.5",       // TODO Phase 70: bind to dose input field
            "unit" to "mg",        // TODO Phase 70: bind to unit selector
            "site" to "",          // TODO Phase 70: bind to site picker (empty = not specified)
            "source" to "wear_os"
            // user_id intentionally omitted — phone stamps from authenticated session (T-57-AUTH)
        )
        WatchDataLayerService.sendQueuedLog(this, logMap)
        finish()
    }
}

@Composable
private fun QuickLogScreen(onLog: () -> Unit) {
    MaterialTheme {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Button(onClick = onLog) {
                // TODO Phase 70: replace with dose/unit/site selection UI
                Text(text = "Log")
            }
        }
    }
}
