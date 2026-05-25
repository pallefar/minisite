package app.leanshot.wear

import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.ResponseBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.future

/**
 * DoseTileService — Wear OS Tile showing next-dose + streak placeholder.
 *
 * SCAFFOLD ONLY. Tile layout rendering deferred to Phase 70 per CONTEXT D-08.
 *
 * Declared in AndroidManifest.xml with:
 *   android:permission="com.google.android.wearable.permission.BIND_TILE_PROVIDER"
 *   intent-filter: androidx.wear.tiles.action.BIND_TILE_PROVIDER
 *
 * Data contract: complication data (nextDoseDate, currentStreak, nextSite) is computed
 * by the TS watchComplicationData() function in src/lib/watch/complication-data.ts and
 * relayed to the watch via DataClient. Phase 70 wires this DataMap into the tile layout.
 */
class DoseTileService : TileService() {

    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest
    ): ListenableFuture<ResponseBuilders.Tile> = scope.future {
        // TODO Phase 70: Read nextDoseDate, currentStreak, nextSite from local DataMap
        // populated by WatchDataLayerService.onDataChanged. Build a ProtoLayout timeline here.
        buildPlaceholderTile()
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest
    ): ListenableFuture<ResponseBuilders.Resources> = scope.future {
        ResponseBuilders.Resources.Builder()
            .setVersion("1")
            .build()
    }

    private fun buildPlaceholderTile(): ResponseBuilders.Tile {
        // Minimal scaffold tile — replaced with real ProtoLayout in Phase 70.
        return ResponseBuilders.Tile.Builder()
            .setResourcesVersion("1")
            .build()
    }
}
