package com.beavernotes.secure.keystore

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@TauriPlugin
class SecureKeystorePlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "beaver_master_key"
        private const val AES_MODE = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
    }

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun keystoreHasKey(): Boolean {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        return ks.containsAlias(KEY_ALIAS)
    }

    @Command
    fun wrap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(WrapArgs::class.java)
            val data = Base64.decode(args.data, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(AES_MODE)
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            val encrypted = cipher.doFinal(data)
            val out = ByteArrayOutputStream().apply {
                write(cipher.iv.size)
                write(cipher.iv)
                write(encrypted)
            }
            val result = JSObject()
            result.put("blob", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "wrap failed")
        }
    }

    @Command
    fun unwrap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UnwrapArgs::class.java)
            val raw = Base64.decode(args.blob, Base64.NO_WRAP)
            val ivLen = raw[0].toInt()
            val iv = raw.copyOfRange(1, 1 + ivLen)
            val encrypted = raw.copyOfRange(1 + ivLen, raw.size)
            val cipher = Cipher.getInstance(AES_MODE)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_BITS, iv))
            val plain = cipher.doFinal(encrypted)
            val result = JSObject()
            result.put("data", Base64.encodeToString(plain, Base64.NO_WRAP))
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "unwrap failed")
        }
    }

    @Command
    fun hasKey(invoke: Invoke) {
        val result = JSObject()
        result.put("has_key", keystoreHasKey())
        invoke.resolve(result)
    }

    @Command
    fun deleteKey(invoke: Invoke) {
        try {
            val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            ks.deleteEntry(KEY_ALIAS)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "deleteKey failed")
        }
    }
}

@InvokeArg
class WrapArgs {
    var data: String = ""
}

@InvokeArg
class UnwrapArgs {
    var blob: String = ""
}
