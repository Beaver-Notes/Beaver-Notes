package app.tauri.sharesheet

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import android.webkit.WebView
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import org.json.JSONArray

@InvokeArg
class ShareTextOptions {
    lateinit var text: String
    var mimeType: String = "text/plain"
}

@InvokeArg
class ShareFileOptions {
    lateinit var path: String
    var mimeType: String? = null
}

@TauriPlugin
class SharesheetPlugin(private val activity: Activity): Plugin(activity) {
    companion object {
        @Volatile private var pendingJson: String = "[]"
    }

    override fun load(webView: WebView) {
        super.load(webView)
        // COLD START: MainActivity was launched by the share intent before the plugin existed.
        handleIntent(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // WARM START: singleTask activity receives the share intent here.
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action ?: return
        val shares = mutableListOf<Map<String, Any?>>()

        when (action) {
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                val stream = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
                val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
                val mime = intent.type ?: ""
                if (stream != null) {
                    val cached = copyToCache(stream)
                    shares.add(mapOf(
                        "id" to UUID.randomUUID().toString(),
                        "kind" to if (mime.startsWith("image/")) "image" else "file",
                        "mime_type" to mime,
                        "title" to subject,
                        "text" to text,
                        "url" to "",
                        "file_paths" to listOf(cached),
                        "added_at" to nowIso(),
                    ))
                } else if (text.isNotEmpty()) {
                    val url = Regex("https?://\\S+").find(text)?.value ?: ""
                    shares.add(mapOf(
                        "id" to UUID.randomUUID().toString(),
                        "kind" to if (url.isNotEmpty()) "url" else "text",
                        "mime_type" to mime.ifEmpty { "text/plain" },
                        "title" to subject,
                        "text" to text,
                        "url" to url,
                        "file_paths" to emptyList<String>(),
                        "added_at" to nowIso(),
                    ))
                }
            }
            Intent.ACTION_VIEW -> {
                // Open-with from Files / another app: same pending-share channel
                // as SEND (cold `load` + warm `onNewIntent` both land here).
                // Frontend drains via getPendingShare → share store hydrateItem →
                // importSharedFile, which already handles .bea/.md/.txt/.html.
                val uri: Uri? = intent.data
                if (uri != null) {
                    val cached = copyToCache(uri)
                    if (cached.isNotEmpty()) {
                        shares.add(mapOf(
                            "id" to UUID.randomUUID().toString(),
                            "kind" to "file",
                            "mime_type" to (intent.type ?: ""),
                            "title" to (queryDisplayName(uri) ?: ""),
                            "text" to "",
                            "url" to "",
                            "file_paths" to listOf(cached),
                            "added_at" to nowIso(),
                        ))
                    }
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                // Collapses to ONE share carrying all paths in order.
                @Suppress("DEPRECATION")
                val streams = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                val mime = intent.type ?: ""
                val cached = (streams ?: emptyList()).map { copyToCache(it) }
                shares.add(mapOf(
                    "id" to UUID.randomUUID().toString(),
                    "kind" to if (mime.startsWith("image/")) "image" else "file",
                    "mime_type" to mime,
                    "title" to (intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""),
                    "text" to (intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""),
                    "url" to "",
                    "file_paths" to cached,
                    "added_at" to nowIso(),
                ))
            }
            else -> return
        }
        if (shares.isNotEmpty()) {
            pendingJson = JSONArray(shares).toString()
            trigger("share-received", JSObject())
        }
    }

    private fun copyToCache(uri: Uri): String {
        return try {
            val resolver = activity.contentResolver
            val name = queryDisplayName(uri) ?: "shared-${System.currentTimeMillis()}"
            val dst = File(activity.cacheDir, name)
            resolver.openInputStream(uri)?.use { input ->
                dst.outputStream().use { input.copyTo(it) }
            }
            dst.absolutePath
        } catch (e: Exception) {
            ""
        }
    }

    private fun queryDisplayName(uri: Uri): String? = try {
        activity.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
        }
    } catch (e: Exception) { null }

    // java.time.Instant needs API 26+ (minSdk 24, no desugaring); SimpleDateFormat works everywhere.
    private fun nowIso(): String {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(Date())
    }

    @Command
    fun getPendingShare(invoke: Invoke) {
        val ret = JSObject(); ret.put("payload", pendingJson); invoke.resolve(ret)
    }

    @Command
    fun clearPendingShare(invoke: Invoke) {
        pendingJson = "[]"; invoke.resolve()
    }

    @Command
    fun shareText(invoke: Invoke) {
        val args = invoke.parseArgs(ShareTextOptions::class.java)
        val sendIntent = Intent().apply {
            this.action = Intent.ACTION_SEND
            this.type = args.mimeType
            this.putExtra(Intent.EXTRA_TEXT, args.text)
        }
        val shareIntent = Intent.createChooser(sendIntent, null)
        shareIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.applicationContext?.startActivity(shareIntent)
        invoke.resolve()
    }

    @Command
    fun shareFile(invoke: Invoke) {
        val args = invoke.parseArgs(ShareFileOptions::class.java)
        val sourceFile = File(args.path)
        if (!sourceFile.exists()) {
            invoke.reject("File not found: ${args.path}")
            return
        }

        // Copy to cache dir so FileProvider can always serve it
        val cacheFile = File(activity.cacheDir, sourceFile.name)
        sourceFile.copyTo(cacheFile, overwrite = true)

        val mimeType = args.mimeType ?: getMimeType(cacheFile.name) ?: "*/*"
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", cacheFile)

        val sendIntent = Intent().apply {
            this.action = Intent.ACTION_SEND
            this.type = mimeType
            this.putExtra(Intent.EXTRA_STREAM, uri)
            this.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val shareIntent = Intent.createChooser(sendIntent, null)
        shareIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.applicationContext?.startActivity(shareIntent)
        invoke.resolve()
    }

    private fun getMimeType(fileName: String): String? {
        val extension = fileName.substringAfterLast('.', "")
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
            ?: when (extension.lowercase()) {
                "md" -> "text/markdown"
                "bea" -> "application/json"
                else -> null
            }
    }
}
