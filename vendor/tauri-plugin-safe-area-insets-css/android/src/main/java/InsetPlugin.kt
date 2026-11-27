package com.plugin.safe.area.insets.css

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import android.os.Build
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import android.util.Log

private const val TAG = "InsetPlugin"

@InvokeArg
class PingArgs {
  var value: String? = null
}

@TauriPlugin
class InsetPlugin(private val activity: Activity): Plugin(activity) {

    override fun load(webView: WebView) {
        super.load(webView)
        observeFoldState()
        val rootView = activity.window.decorView

// On écoute les changements de WindowInsets
ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, insets ->
    val imeHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom

    if (imeHeight > 0) {
       trigger("keyboard_shown",JSObject())
    } else {
       trigger("keyboard_hidden",JSObject())
    }
insets

}
    }

    @Command
    fun getTopInset(invoke: Invoke) {
        val topInset = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        activity.window.decorView.rootWindowInsets?.getInsets(android.view.WindowInsets.Type.statusBars())?.top ?: 0
    } else {
        0
    }
    val topInsetDIP = toDIPFromPixel(topInset.toFloat()).toDouble()
    val result = JSObject()
    result.put("inset", topInsetDIP)
    invoke.resolve(result)
    }
    @Command
    fun getBottomInset(invoke: Invoke) {
        val bottomInset = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.window.decorView.rootWindowInsets?.getInsets(android.view.WindowInsets.Type.navigationBars())?.bottom ?: 0
        } else {
            0
        }
        val bottomInsetDIP = toDIPFromPixel(bottomInset.toFloat()).toDouble()
        val result = JSObject()
        result.put("inset", bottomInsetDIP)
        invoke.resolve(result)
    }

 private fun toDIPFromPixel(pixels: Float): Float {
       val density = activity.resources.displayMetrics.density

       return pixels / density
   }

    // MARK: - Fold geometry (Android foldables)
    // Cached from the window-info listener: the command is synchronous for JS,
    // and a fold changes far less often than the web layer asks.
    private var foldState: JSObject? = null
    private val foldScope = CoroutineScope(Dispatchers.Main.immediate)

    private fun observeFoldState() {
        try {
            foldScope.launch {
                WindowInfoTracker.getOrCreate(activity)
                    .windowLayoutInfo(activity)
                    .collect { info -> foldState = foldStateFrom(info) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Fold info unavailable", e)
        }
    }

    private fun foldStateFrom(info: WindowLayoutInfo): JSObject {
        val feature = info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull()
            ?: return unknownFoldState()

        val rect = JSObject()
        rect.put("left", toDIPFromPixel(feature.bounds.left.toFloat()).toDouble())
        rect.put("top", toDIPFromPixel(feature.bounds.top.toFloat()).toDouble())
        rect.put("width", toDIPFromPixel(feature.bounds.width().toFloat()).toDouble())
        rect.put("height", toDIPFromPixel(feature.bounds.height().toFloat()).toDouble())

        val result = unknownFoldState()
        result.put("foldable", true)
        result.put("posture", if (feature.state == FoldingFeature.State.FLAT) "flat" else "half-open")
        result.put("orientation",
            if (feature.orientation == FoldingFeature.Orientation.VERTICAL) "vertical" else "horizontal")
        result.put("crease", rect)
        return result
    }

    private fun unknownFoldState(): JSObject {
        val result = JSObject()
        result.put("foldable", false)
        result.put("posture", "unknown")
        result.put("hingeAngle", null)
        result.put("orientation", "none")
        result.put("crease", null)
        result.put("verticalBarEdge", "none")
        return result
    }

    @Command
    fun getFoldState(invoke: Invoke) {
        invoke.resolve(foldState ?: unknownFoldState())
    }

    @Command
    fun setScribbleTargets(invoke: Invoke) {
        invoke.resolve(JSObject())
    }
}
