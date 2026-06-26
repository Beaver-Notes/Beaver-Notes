package com.plugin.pdf.render

import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.provider.DocumentsContract
import android.util.Log
import android.webkit.WebView
import android.webkit.WebViewClient
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream

private const val TAG = "PdfRender"

@InvokeArg
class RenderArgs {
    var htmlPath: String? = null
    var outputPath: String? = null
    var measureScript: String? = null
    var timeoutMs: Long? = 30_000L
}

@InvokeArg
class WriteScopedArgs {
    var sourcePath: String? = null
    var scopedOutputPath: String? = null
}

/**
 * Resolves a `scoped:<folder_id>/<relative_path>` into a content URI
 * by looking up the stored folder URI in SharedPreferences
 * (the same store that `tauri-plugin-scoped-storage` uses).
 */
private class ScopedPathResolver(private val activity: Activity) {
    private val prefs = activity.getSharedPreferences("scoped_storage", Activity.MODE_PRIVATE)

    data class Parsed(val folderId: String, val relativePath: String)

    fun parse(path: String): Parsed? {
        if (!path.startsWith("scoped:")) return null
        val remainder = path.removePrefix("scoped:")
        val slashIdx = remainder.indexOf('/')
        if (slashIdx <= 0 || slashIdx == remainder.lastIndex) return null
        val folderId = remainder.substring(0, slashIdx)
        val relative = remainder.substring(slashIdx + 1)
        if (folderId.isEmpty() || relative.isEmpty()) return null
        return Parsed(folderId, relative)
    }

    fun resolveFolderUri(folderId: String): Uri? {
        val uriString = prefs.getString("folder:$folderId:uri", null) ?: return null
        return Uri.parse(uriString)
    }
}

@TauriPlugin
class PdfRenderPlugin(private val activity: Activity) : Plugin(activity) {

    override fun load(webView: WebView) {
        super.load(webView)
    }

    @Command
    fun render(invoke: Invoke) {
        val args = invoke.parseArgs(RenderArgs::class.java)
        val htmlPath = args.htmlPath
        val outputPath = args.outputPath
        val measureScript = args.measureScript
        val timeoutMs = args.timeoutMs ?: 30_000L

        if (htmlPath.isNullOrEmpty() || outputPath.isNullOrEmpty() || measureScript.isNullOrEmpty()) {
            invoke.reject("missing required fields")
            return
        }

        val main = Handler(Looper.getMainLooper())
        main.post {
            runRender(
                htmlPath = htmlPath,
                outputPath = outputPath,
                measureScript = measureScript,
                timeoutMs = timeoutMs,
                invoke = invoke,
            )
        }
    }

    /**
     * Copy a file from a local temp path into a `scoped:` destination.
     * Called by the Rust side after the A4-split step completes,
     * because `std::fs::write` cannot resolve the scoped scheme.
     */
    @Command
    fun writeScoped(invoke: Invoke) {
        val args = invoke.parseArgs(WriteScopedArgs::class.java)
        val sourcePath = args.sourcePath
        val scopedOutputPath = args.scopedOutputPath

        if (sourcePath.isNullOrEmpty() || scopedOutputPath.isNullOrEmpty()) {
            invoke.reject("writeScoped: missing required fields")
            return
        }

        Log.i(TAG, "writeScoped: source=$sourcePath dest=$scopedOutputPath")

        // Read the source file
        val sourceFile = File(sourcePath)
        val data: ByteArray
        try {
            data = sourceFile.readBytes()
        } catch (e: Throwable) {
            Log.e(TAG, "writeScoped: failed to read source", e)
            invoke.reject("writeScoped: failed to read source file: ${e.message}")
            return
        }

        // Resolve the scoped destination
        val resolver = ScopedPathResolver(activity)
        val parsed = resolver.parse(scopedOutputPath)
        if (parsed == null) {
            invoke.reject("writeScoped: not a valid scoped path: $scopedOutputPath")
            return
        }

        val folderUri = resolver.resolveFolderUri(parsed.folderId)
        if (folderUri == null) {
            invoke.reject("writeScoped: folder not found: ${parsed.folderId}")
            return
        }

        try {
            // Navigate to (or create) the parent directory inside the scoped tree.
            val parentDocUri = resolveOrCreateDirectory(
                folderUri,
                parsed.relativePath.substringBeforeLast('/', "")
            )

            val fileName = parsed.relativePath.substringAfterLast('/')
            val mimeType = "application/pdf"

            // Create the file under the resolved parent directory.
            val fileUri = DocumentsContract.createDocument(
                activity.contentResolver,
                parentDocUri,
                mimeType,
                fileName
            ) ?: throw IllegalStateException("createDocument returned null for $fileName")

            // Write the bytes.
            activity.contentResolver.openOutputStream(fileUri, "wt")?.use { os ->
                os.write(data)
            } ?: throw IllegalStateException("openOutputStream returned null")

            Log.i(TAG, "writeScoped: wrote ${data.size} bytes to $scopedOutputPath")
            invoke.resolve()
        } catch (e: Throwable) {
            Log.e(TAG, "writeScoped: write failed", e)
            invoke.reject("writeScoped: write failed: ${e.message}")
        }
    }

    /**
     * Walk a relative path under a tree document URI, creating
     * intermediate directories as needed. Returns the document URI
     * for the final directory.
     */
    private fun resolveOrCreateDirectory(treeUri: Uri, relativePath: String): Uri {
        if (relativePath.isEmpty()) return treeUri

        val documentId = DocumentsContract.getTreeDocumentId(treeUri)
        var currentUri = DocumentsContract.buildDocumentUriUsingTree(
            treeUri, documentId
        )

        for (segment in relativePath.split('/')) {
            if (segment.isEmpty()) continue

            // Check if a child with this name already exists.
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                treeUri, DocumentsContract.getDocumentId(currentUri)
            )
            var foundUri: Uri? = null
            activity.contentResolver.query(
                childrenUri,
                arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
                null, null, null
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    val childDocId = cursor.getString(0)
                    val childUri = DocumentsContract.buildDocumentUriUsingTree(
                        treeUri, childDocId
                    )
                    val nameCursor = activity.contentResolver.query(
                        childUri,
                        arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                        null, null, null
                    )
                    val name = nameCursor?.use { nc ->
                        if (nc.moveToFirst()) nc.getString(0) else null
                    }
                    if (name == segment) {
                        foundUri = childUri
                        break
                    }
                }
            }

            currentUri = if (foundUri != null) {
                foundUri
            } else {
                DocumentsContract.createDocument(
                    activity.contentResolver,
                    currentUri,
                    DocumentsContract.Document.MIME_TYPE_DIR,
                    segment
                ) ?: throw IllegalStateException("createDocument(dir) returned null for $segment")
            }
        }

        return currentUri
    }

    private fun runRender(
        htmlPath: String,
        outputPath: String,
        measureScript: String,
        timeoutMs: Long,
        invoke: Invoke,
    ) {
        val context = activity.applicationContext
        val webView = WebView(activity)
        webView.settings.javaScriptEnabled = true

        // Bounded timeout
        val main = Handler(Looper.getMainLooper())
        var settled = false
        val timeoutRunnable = Runnable {
            if (settled) return@Runnable
            settled = true
            invoke.reject("render timed out after ${timeoutMs}ms")
            webView.destroy()
        }
        main.postDelayed(timeoutRunnable, timeoutMs)

        fun finish(ok: Boolean, error: String?, blocksJson: String) {
            if (settled) return
            settled = true
            main.removeCallbacks(timeoutRunnable)
            if (ok) {
                val ret = JSObject()
                ret.put("keepBlocksJson", blocksJson)
                invoke.resolve(ret)
            } else {
                invoke.reject(error ?: "unknown error")
            }
            webView.destroy()
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(measureScript) { rawBlocks ->
                    val blocks = (rawBlocks ?: "[]").trim('"')
                        .replace("\\\"", "\"")
                        .replace("\\\\", "\\")

                    val outFile = File(outputPath)
                    outFile.parentFile?.mkdirs()

                    val printAdapter = view.createPrintDocumentAdapter("Beaver Notes")
                    val attrs = PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .build()
                    val layoutCallback = object : PrintDocumentAdapter.LayoutResultCallback() {}
                    printAdapter.onLayout(attrs, attrs, null, layoutCallback, null)

                    val os = FileOutputStream(outFile)
                    printAdapter.onWrite(
                        arrayOf(PageRange.ALL_PAGES),
                        os,
                        object : PrintDocumentAdapter.WriteResultCallback() {
                            override fun onWriteFinished(pages: Array<PageRange>) {
                                try { os.close() } catch (_: Throwable) {}
                                finish(true, null, blocks)
                            }

                            override fun onWriteFailed(error: CharSequence?) {
                                try { os.close() } catch (_: Throwable) {}
                                finish(false, "write pdf: ${error ?: "unknown"}", blocks)
                            }
                        },
                    )
                }
            }

            override fun onReceivedError(
                view: WebView,
                errorCode: Int,
                description: String?,
                failingUrl: String?,
            ) {
                finish(false, "navigation failed: $description", "[]")
            }
        }
        webView.loadUrl("file://$htmlPath")
    }
}
