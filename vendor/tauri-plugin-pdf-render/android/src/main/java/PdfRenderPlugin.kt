package com.plugin.pdf.render

import android.app.Activity
import android.net.Uri
import android.os.CancellationSignal
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
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val TAG = "PdfRender"

@InvokeArg
class RenderArgs {
    var htmlPath: String? = null
    var outputPath: String? = null
    var timeoutMs: Long? = 30_000L
}

@InvokeArg
class WriteScopedArgs {
    var sourcePath: String? = null
    var scopedOutputPath: String? = null
}

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

    override fun load(webView: WebView) {}

    @Command
    fun render(invoke: Invoke) {
        val args = invoke.parseArgs(RenderArgs::class.java)
        val htmlPath = args.htmlPath
        val outputPath = args.outputPath
        val timeoutMs = args.timeoutMs ?: 30_000L

        if (htmlPath.isNullOrEmpty() || outputPath.isNullOrEmpty()) {
            invoke.reject("missing required fields")
            return
        }

        val main = Handler(Looper.getMainLooper())
        main.post {
            runRender(htmlPath, outputPath, timeoutMs, invoke)
        }
    }

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

        val sourceFile = File(sourcePath)
        val data: ByteArray
        try {
            data = sourceFile.readBytes()
        } catch (e: Throwable) {
            Log.e(TAG, "writeScoped: failed to read source", e)
            invoke.reject("writeScoped: failed to read source file: ${e.message}")
            return
        }

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
            val parentDocUri = resolveOrCreateDirectory(
                folderUri,
                parsed.relativePath.substringBeforeLast('/', "")
            )

            val fileName = parsed.relativePath.substringAfterLast('/')
            val mimeType = "application/pdf"

            val fileUri = DocumentsContract.createDocument(
                activity.contentResolver,
                parentDocUri,
                mimeType,
                fileName
            ) ?: throw IllegalStateException("createDocument returned null for $fileName")

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

    private fun resolveOrCreateDirectory(treeUri: Uri, relativePath: String): Uri {
        if (relativePath.isEmpty()) {
            return DocumentsContract.buildDocumentUriUsingTree(
                treeUri,
                DocumentsContract.getTreeDocumentId(treeUri)
            )
        }

        val documentId = DocumentsContract.getTreeDocumentId(treeUri)
        var currentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)

        for (segment in relativePath.split('/')) {
            if (segment.isEmpty()) continue

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
                    val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId)
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

    // ── Android native print pipeline ─────────────────────────────────
    //
    // We drive the WebView's PrintDocumentAdapter directly with concrete
    // callback subclasses loaded from an embedded DEX.  The real
    // LayoutResultCallback/WriteResultCallback constructors ARE public
    // at runtime (only @hide in the SDK stubs), but we can't extend
    // them in normal code because the stubs show package-private.
    // Instead we compiled concrete subclasses against fake stubs and
    // embedded the resulting DEX below, loading it with
    // InMemoryDexClassLoader.
    //
    // Both adapter.onLayout and onWrite are async (they queue native
    // Chromium work and return).  Chromium posts results to the
    // main-thread Looper, calling our callback methods.  Since we
    // don't need the callbacks for signalling, we rely on generous
    // Thread.sleep() waits for the native work to complete.

    // Pre-compiled DEX containing ConcreteLayoutCallback and
    // ConcreteWriteCallback (concrete subclasses of the print
    // callbacks with CountDownLatch signaling).  Generated via:
    //   javac -d out .../ConcreteLayoutCallback.java .../ConcreteWriteCallback.java
    //   d8 --lib fake-stubs.jar --output out-dex out/Concrete*.class
    private val DEX_BYTES = android.util.Base64.decode(
        "ZGV4CjAzNQBHOrF6zEw6sHrUk5l+DDiZ5IuOMb7lTe/IBgAAcAAAAHhWNBIAAAAAAAAAABwGAAAYAAAAcAAAAAoAAADQAAAABQAAAPgAAAACAAAANAEAAAsAAABEAQAAAgAAAJwBAADsBAAA3AEAACoDAAAyAwAATwMAAGsDAACmAwAA4AMAAAMEAAAzBAAAYgQAAHwEAACjBAAApgQAAKoEAACvBAAAsgQAAM4EAADZBAAA4AQAAPMEAAADBQAAFQUAACcFAAA2BQAARwUAAAMAAAAEAAAABQAAAAYAAAAHAAAACAAAAAkAAAAKAAAADQAAAA4AAAAKAAAABwAAAAAAAAAMAAAABwAAAAwDAAALAAAABwAAABQDAAALAAAABwAAABwDAAALAAAABwAAACQDAAADAAYAEAAAAAQABgAQAAAAAAAAAAAAAAABAAAAAAAAAAMAAwAAAAAAAwAAABEAAAADAAIAEgAAAAMAAQATAAAABAADAAAAAAAEAAAAFAAAAAQAAgAVAAAABAAEABYAAAAGAAAADwAAAAMAAAABAAAAAAAAAAAAAAABAAAAAAAAAOUFAAAAAAAABAAAAAEAAAABAAAAAAAAAAIAAAAAAAAA/QUAAAAAAAACAAIAAQAAAOwCAAAGAAAAcBAAAAAAWwEAAA4AAgABAAEAAADzAgAACgAAAFQQAAA4AAcAVBAAAG4QCgAAAA4AAgACAAEAAAD4AgAACgAAAFQBAAA4AQcAVAEAAG4QCgABAA4AAwADAAEAAAD+AgAACgAAAFQBAAA4AQcAVAEAAG4QCgABAA4AAgACAAEAAADsAgAABgAAAHAQAQAAAFsBAQAOAAIAAQABAAAA8wIAAAoAAABUEAEAOAAHAFQQAQBuEAoAAAAOAAIAAgABAAAA+AIAAAoAAABUAQEAOAEHAFQBAQBuEAoAAQAOAAIAAgABAAAABQMAAAoAAABUAQEAOAEHAFQBAQBuEAoAAQAOAAoBAA48LQAXAA6WABMBAA6WAA8CAAAOlgAPAQAOlgAAAgAAAAIACAABAAAABQAAAAEAAAAGAAAAAQAAAAkABjxpbml0PgAbQ29uY3JldGVMYXlvdXRDYWxsYmFjay5qYXZhABpDb25jcmV0ZVdyaXRlQ2FsbGJhY2suamF2YQA5TGFuZHJvaWQvcHJpbnQvUHJpbnREb2N1bWVudEFkYXB0ZXIkTGF5b3V0UmVzdWx0Q2FsbGJhY2s7ADhMYW5kcm9pZC9wcmludC9QcmludERvY3VtZW50QWRhcHRlciRXcml0ZVJlc3VsdENhbGxiYWNrOwAhTGFuZHJvaWQvcHJpbnQvUHJpbnREb2N1bWVudEluZm87AC5MY29tL3BsdWdpbi9wZGYvcmVuZGVyL0NvbmNyZXRlTGF5b3V0Q2FsbGJhY2s7AC1MY29tL3BsdWdpbi9wZGYvcmVuZGVyL0NvbmNyZXRlV3JpdGVDYWxsYmFjazsAGExqYXZhL2xhbmcvQ2hhclNlcXVlbmNlOwAlTGphdmEvdXRpbC9jb25jdXJyZW50L0NvdW50RG93bkxhdGNoOwABVgACVkwAA1ZMWgABWgAaW0xhbmRyb2lkL3ByaW50L1BhZ2VSYW5nZTsACWNvdW50RG93bgAFbGF0Y2gAEW9uTGF5b3V0Q2FuY2VsbGVkAA5vbkxheW91dEZhaWxlZAAQb25MYXlvdXRGaW5pc2hlZAAQb25Xcml0ZUNhbmNlbGxlZAANb25Xcml0ZUZhaWxlZAAPb25Xcml0ZUZpbmlzaGVkAJsBfn5EOHsiYmFja2VuZCI6ImRleCIsImNvbXBpbGF0aW9uLW1vZGUiOiJkZWJ1ZyIsImhhcy1jaGVja3N1bXMiOmZhbHNlLCJtaW4tYXBpIjoxLCJzaGEtMSI6Ijc1MGEyMWI0ZjQyODFiMWY0NTNiNjQ5ZTBiODRmMWJhOWMwNGY0ZmMiLCJ2ZXJzaW9uIjoiOS4wLjMtZGV2In0AAAEBAwACAoGABNwDAwH4AwEBnAQBAcAEAAEBAwECBoGABOQEBwGABQEBpAUBAcgFAAAAAAAAAA4AAAAAAAAAAQAAAAAAAAABAAAAGAAAAHAAAAACAAAACgAAANAAAAADAAAABQAAAPgAAAAEAAAAAgAAADQBAAAFAAAACwAAAEQBAAAGAAAAAgAAAJwBAAABIAAACAAAANwBAAADIAAABQAAAOwCAAABEAAABAAAAAwDAAACIAAAGAAAACoDAAAAIAAAAgAAAOUFAAADEAAAAQAAABgGAAAAEAAAAQAAABwGAAA=",
        android.util.Base64.DEFAULT
    )

    private var dexClassLoader: dalvik.system.InMemoryDexClassLoader? = null
    private var layoutCbClass: Class<*>? = null
    private var writeCbClass: Class<*>? = null

    private fun initDex(parentLoader: ClassLoader) {
        if (dexClassLoader != null) return
        val buffer = java.nio.ByteBuffer.wrap(DEX_BYTES)
        val loader = dalvik.system.InMemoryDexClassLoader(buffer, parentLoader)
        layoutCbClass = loader.loadClass("com.plugin.pdf.render.ConcreteLayoutCallback")
        writeCbClass = loader.loadClass("com.plugin.pdf.render.ConcreteWriteCallback")
        dexClassLoader = loader
    }

    private fun createLayoutCb(latch: CountDownLatch): PrintDocumentAdapter.LayoutResultCallback {
        val clazz = layoutCbClass ?: error("DEX not initialized")
        return clazz.getDeclaredConstructor(CountDownLatch::class.java).newInstance(latch) as PrintDocumentAdapter.LayoutResultCallback
    }

    private fun createWriteCb(latch: CountDownLatch): PrintDocumentAdapter.WriteResultCallback {
        val clazz = writeCbClass ?: error("DEX not initialized")
        return clazz.getDeclaredConstructor(CountDownLatch::class.java).newInstance(latch) as PrintDocumentAdapter.WriteResultCallback
    }

    private fun runRender(
        htmlPath: String,
        outputPath: String,
        timeoutMs: Long,
        invoke: Invoke,
    ) {
        val context = activity.applicationContext

        val webView = WebView(activity)
        webView.settings.javaScriptEnabled = true

        val main = Handler(Looper.getMainLooper())
        var settled = false

        val timeoutRunnable = Runnable {
            if (settled) return@Runnable
            settled = true
            invoke.reject("render timed out after ${timeoutMs}ms")
            main.post { webView.destroy() }
        }
        main.postDelayed(timeoutRunnable, timeoutMs)

        fun finish(error: String?) {
            if (settled) return
            settled = true
            main.removeCallbacks(timeoutRunnable)
            if (error != null) {
                invoke.reject(error)
            } else {
                invoke.resolve()
            }
            main.post { webView.destroy() }
        }

        val htmlContent: String = try {
            File(htmlPath).readText()
        } catch (e: Exception) {
            finish("failed to read HTML file: ${e.message}")
            return
        }

        // Strip the JavaScript pagination script — Android's native
        // PrintDocumentAdapter handles pagination itself (just like iOS),
        // and explicit break-after:page markers from the script cause
        // Chromium to produce many extra blank pages.
        val strippedHtml = htmlContent.replace(
            Regex("<script>[\\s\\S]*?__bnPaginate[\\s\\S]*?</script>"),
            ""
        )

        val tempHtml = File(context.cacheDir, "beaver-render-${System.nanoTime()}.html")
        try {
            tempHtml.writeText(strippedHtml)
        } catch (e: Exception) {
            finish("failed to write temp HTML: ${e.message}")
            return
        }

        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = true
        // Force the viewport to match the CSS content width (674px) so text
        // wrapping in the WebView matches the paginated layout. Without these
        // the WebView may pick a much wider viewport and inflate content height.
        webView.settings.useWideViewPort = false
        webView.settings.loadWithOverviewMode = false

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                if (settled) return

                // Inject @page margin so every page in the PDF has consistent
                // margins (body padding only applies on the first page fragment
                // in paginated media, causing lost top padding on pages 2+).
                // 60px = ~15.9mm, matches the content-width constraint
                // (width: 674px) so the printable area is exactly A4 minus margins.
                webView.evaluateJavascript("""
                    (function(){
                        var s = document.createElement('style');
                        s.textContent = '@page { margin: 60px; }';
                        document.head.appendChild(s);
                    })()
                """.trimIndent(), null)

                // Let the page render fully before starting the print pipeline
                main.postDelayed({
                    if (settled) return@postDelayed

                    printWithAdapter(webView, outputPath, main, timeoutMs) { err ->
                        finish(err)
                    }
                }, 500)
            }

            @Suppress("DEPRECATION")
            override fun onReceivedError(
                view: WebView,
                errorCode: Int,
                description: String?,
                failingUrl: String?,
            ) {
                if (settled) return
                Log.e(TAG, "navigation error ($errorCode): $description url=$failingUrl")
                settled = true
                main.removeCallbacks(timeoutRunnable)
                invoke.reject("navigation failed: $description")
            }
        }

        webView.loadUrl("file://${tempHtml.absolutePath}")
    }

    // ── Native print pipeline ──────────────────────────────────────

    private fun printWithAdapter(
        webView: WebView,
        outputPath: String,
        main: Handler,
        timeoutMs: Long,
        done: (String?) -> Unit,
    ) {
        Thread {
            try {
                val cancellationSignal = CancellationSignal()

                val attributes = PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                    .setResolution(PrintAttributes.Resolution("a4", "A4", 300, 300))
                    .setMinMargins(PrintAttributes.Margins(0, 0, 0, 0))
                    .build()

                initDex(activity.classLoader)
                val layoutLatch = CountDownLatch(1)
                val writeLatch = CountDownLatch(1)
                val layoutCb = createLayoutCb(layoutLatch)
                val writeCb = createWriteCb(writeLatch)

                // Both createPrintDocumentAdapter and onLayout must run
                // on the main thread (WebView thread check).
                val adapterRef = arrayOf<PrintDocumentAdapter?>(null)
                val posted = CountDownLatch(1)
                main.post {
                    val a = webView.createPrintDocumentAdapter("Document")
                    adapterRef[0] = a
                    a.onLayout(null, attributes, cancellationSignal, layoutCb, null)
                    posted.countDown()
                }
                // Wait for onLayout to actually be invoked on the main thread
                if (!posted.await(5, TimeUnit.SECONDS)) {
                    done("print layout post timed out")
                    return@Thread
                }
                // Wait for Chromium's async layout to complete (signaled via
                // onLayoutFinished / onLayoutFailed / onLayoutCancelled)
                if (!layoutLatch.await(timeoutMs / 2, TimeUnit.MILLISECONDS)) {
                    done("print layout timed out")
                    return@Thread
                }

                val tempPdf = File(
                    activity.cacheDir,
                    "print-${System.nanoTime()}.pdf"
                )

                val writeFd = android.os.ParcelFileDescriptor.open(
                    tempPdf,
                    android.os.ParcelFileDescriptor.MODE_READ_WRITE or
                        android.os.ParcelFileDescriptor.MODE_CREATE or
                        android.os.ParcelFileDescriptor.MODE_TRUNCATE
                )

                val adapter = adapterRef[0]!!
                val writePosted = CountDownLatch(1)
                main.post {
                    adapter.onWrite(
                        arrayOf(PageRange.ALL_PAGES),
                        writeFd,
                        cancellationSignal,
                        writeCb
                    )
                    writePosted.countDown()
                }
                if (!writePosted.await(5, TimeUnit.SECONDS)) {
                    done("print write post timed out")
                    return@Thread
                }
                // Wait for Chromium's async write to complete (signaled via
                // onWriteFinished / onWriteFailed / onWriteCancelled)
                if (!writeLatch.await(timeoutMs / 2, TimeUnit.MILLISECONDS)) {
                    done("print write timed out")
                    return@Thread
                }

                writeFd.close()
                tempPdf.copyTo(File(outputPath), overwrite = true)
                Log.i(TAG, "wrote PDF to $outputPath (${tempPdf.length()} bytes)")
                tempPdf.delete()
                done(null)

            } catch (e: Exception) {
                Log.e(TAG, "print failed", e)
                done("print failed: ${e.message}")
            }
        }.start()
    }
}
