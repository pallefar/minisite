package app.leanshot.wear

import android.content.Context
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService

/**
 * WatchDataLayerService — Wear OS DataClient bridge for offline-tolerant quick-log relay.
 *
 * Security contract (T-57-AUTH, T-57-LOSS):
 *   - NO backend/HTTP calls. The watch relays through the phone only.
 *   - No direct backend HTTP calls are permitted from this module.
 *   - user_id is NEVER included in the watch payload; the phone stamps it from its session.
 *
 * Offline tolerance (T-57-LOSS):
 *   - Uses DataClient.putDataItem (persisted, synced on reconnect).
 *   - Path: /quick-log/{deduped_id} — idempotent upsert key matching TS sync-contract.ts.
 *
 * Payload shape mirrors TS WatchQueuedLog in src/lib/watch/sync-contract.ts:
 *   { deduped_id, datetime, dose, unit, site, source="wear_os" }
 */
class WatchDataLayerService : WearableListenerService() {

    /**
     * Phone-side handler: receives DataItems written by the watch via putDataItem.
     * Deserializes the payload and hands off to the TS dedupeAndMerge() layer
     * via the Capacitor bridge (Phase 70 wiring).
     */
    override fun onDataChanged(events: DataEventBuffer) {
        events.forEach { event ->
            if (event.type == DataEvent.TYPE_CHANGED &&
                event.dataItem.uri.path?.startsWith("/quick-log/") == true
            ) {
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                val payload = dataMap.getString("payload") ?: return@forEach
                // TODO Phase 70: Bridge payload to TS dedupeAndMerge() via Capacitor plugin.
                // The TS layer stamps user_id from the phone's authenticated session before
                // calling addInjection(). No backend call originates from the watch module.
                android.util.Log.d(TAG, "Received quick-log DataItem: $payload")
            }
        }
    }

    companion object {
        private const val TAG = "WatchDataLayerService"

        /**
         * Deterministic dedupe ID for watch quick-logs.
         * Same (source, datetime) always yields the same ID —
         * natural dedupe via ON CONFLICT (log_id) in addInjection upsert path.
         * Algorithm mirrors TS makeDedupedId() in src/lib/watch/sync-contract.ts.
         */
        fun makeDedupedId(source: String, datetime: String): String {
            val input = "$source:$datetime"
            val bytes = ByteArray(16)
            val ns = byteArrayOf(
                0x6b.toByte(), 0xa7.toByte(), 0xb8.toByte(), 0x10.toByte(),
                0x9d.toByte(), 0xad.toByte(), 0x11.toByte(), 0xd1.toByte(),
                0x80.toByte(), 0xb4.toByte(), 0x00.toByte(), 0xc0.toByte(),
                0x4f.toByte(), 0xd4.toByte(), 0x30.toByte(), 0xc8.toByte()
            )
            for (i in 0 until 16) bytes[i] = ns[i]
            for (i in input.indices) {
                val code = input[i].code
                bytes[i % 16] = (bytes[i % 16].toInt() xor (code and 0xff)).toByte()
                bytes[(i + 1) % 16] = (bytes[(i + 1) % 16].toInt() xor ((code shr 8) and 0xff)).toByte()
                val carry = bytes[(i + 2) % 16].toInt() and 0xff
                bytes[(i + 2) % 16] = ((carry shl 3 or (carry ushr 5)) xor (bytes[i % 16].toInt() and 0xff)).toByte()
            }
            bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x50).toByte()
            bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
            val hex = bytes.joinToString("") { "%02x".format(it) }
            return "${hex.substring(0,8)}-${hex.substring(8,12)}-${hex.substring(12,16)}-${hex.substring(16,20)}-${hex.substring(20,32)}"
        }

        /**
         * Send a quick-log DataItem from the watch to the phone via DataClient.putDataItem.
         *
         * Uses putDataItem (persisted, offline-tolerant) — the correct primitive per
         * RESEARCH Pitfall 3 and T-57-LOSS mitigation. Path is idempotent.
         *
         * Path /quick-log/{deduped_id} is idempotent: re-sending the same payload is a no-op.
         */
        fun sendQueuedLog(context: Context, log: Map<String, String>) {
            val dedupedId = log["deduped_id"] ?: return
            val path = "/quick-log/$dedupedId"
            val payload = log.entries.joinToString(",") { (k, v) -> "\"$k\":\"$v\"" }
                .let { "{$it}" }

            val request = PutDataMapRequest.create(path).apply {
                dataMap.putString("payload", payload)
            }

            Wearable.getDataClient(context)
                .putDataItem(request.asPutDataRequest().setUrgent())
                .addOnSuccessListener {
                    android.util.Log.d(TAG, "Quick-log queued via DataClient: $path")
                }
                .addOnFailureListener { e ->
                    // DataItem is persisted locally; will sync when phone reconnects.
                    android.util.Log.w(TAG, "DataClient putDataItem pending sync: ${e.message}")
                }
        }
    }
}
