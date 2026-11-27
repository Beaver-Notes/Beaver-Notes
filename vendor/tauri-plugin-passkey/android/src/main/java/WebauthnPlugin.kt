package net.kackman.webauthn

import android.app.Activity
import androidx.annotation.VisibleForTesting
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject

@TauriPlugin
class WebauthnPlugin(
    activity: Activity,
) : Plugin(activity) {
    private val scope = CoroutineScope(Dispatchers.Main)
    private val credentialManager = CredentialManager.create(activity)
    private val pluginActivity = activity
    private var currentJob: Job? = null

    @Command
    fun register(invoke: Invoke) {
        val args = invoke.parseArgs(String::class.java)

        val createPublicKeyCredentialRequest =
            CreatePublicKeyCredentialRequest(
                requestJson = args,
            )

        currentJob =
            scope.launch {
                try {
                    val result =
                        credentialManager.createCredential(
                            pluginActivity,
                            createPublicKeyCredentialRequest,
                        )

                    when (result) {
                        is CreatePublicKeyCredentialResponse -> {
                            invoke.resolve(flattenPrfOutput(result.registrationResponseJson))
                        }

                        else -> {
                            // Handle other credential types if needed
                            invoke.reject("Invalid credential type")
                        }
                    }
                } catch (e: CancellationException) {
                    invoke.reject("Operation cancelled")
                    throw e
                } catch (e: Exception) {
                    invoke.reject(e.message ?: e.javaClass.simpleName)
                }
            }
    }

    @Command
    fun authenticate(invoke: Invoke) {
        val args = invoke.parseArgs(String::class.java)

        val getPublicKeyCredentialOption =
            GetPublicKeyCredentialOption(
                requestJson = args,
            )
        val getCredRequest =
            GetCredentialRequest(
                listOf(getPublicKeyCredentialOption),
            )

        currentJob =
            scope.launch {
                try {
                    val result =
                        credentialManager
                            .getCredential(
                                pluginActivity,
                                getCredRequest,
                            ).credential

                    when (result) {
                        is PublicKeyCredential -> {
                            invoke.resolve(flattenPrfOutput(result.authenticationResponseJson))
                        }

                        else -> {
                            // Handle other credential types if needed
                            invoke.reject("Invalid credential type")
                        }
                    }
                } catch (e: CancellationException) {
                    invoke.reject("Operation cancelled")
                    throw e
                } catch (e: Exception) {
                    invoke.reject(e.message ?: e.javaClass.simpleName)
                }
            }
    }

    @Command
    fun cancel(invoke: Invoke) {
        currentJob?.cancel()
        currentJob = null
        invoke.resolve()
    }

    internal companion object {
        // The shared Rust parser (mobile.rs) expects a flat top-level `prf`
        // object — {"enabled": bool} after registration, {"first"/"second":
        // base64url} after authentication — matching what the Swift bridges
        // emit, while Credential Manager nests it under clientExtensionResults.
        @VisibleForTesting
        fun flattenPrfOutput(responseJson: String): JSObject {
            val response = JSObject(responseJson)
            val prf =
                response
                    .optJSONObject("clientExtensionResults")
                    ?.optJSONObject("prf")
                    ?: return response
            val flat = JSONObject()
            if (prf.has("enabled")) {
                flat.put("enabled", prf.getBoolean("enabled"))
            }
            prf.optJSONObject("results")?.let { results ->
                results
                    .optString("first")
                    .takeIf { it.isNotEmpty() }
                    ?.let { flat.put("first", it) }
                results
                    .optString("second")
                    .takeIf { it.isNotEmpty() }
                    ?.let { flat.put("second", it) }
            }
            response.put("prf", flat)
            return response
        }
    }
}
