package app.tauri.sharesheet

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

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
    }

    @Command
    fun shareFile(invoke: Invoke) {
        val args = invoke.parseArgs(ShareFileOptions::class.java)
        val sourceFile = File(args.path)
        if (!sourceFile.exists()) return

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
