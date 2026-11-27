package net.kackman.webauthn

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Robolectric supplies a real org.json (the stock android.jar stubs throw
// "not mocked"), so these pure PRF-shape transforms can be exercised on the JVM.
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class WebauthnPluginTest {
    // --- flattenPrfOutput -------------------------------------------------

    @Test
    fun flattenLeavesResponseUnchangedWithoutClientExtensionResults() {
        val input = """{"id":"cred","response":{}}"""
        val result = WebauthnPlugin.flattenPrfOutput(input)
        assertFalse("no top-level prf should be added", result.has("prf"))
        assertEquals("cred", result.getString("id"))
    }

    @Test
    fun flattenExtractsEnabledAfterRegistration() {
        val input = """{"clientExtensionResults":{"prf":{"enabled":true}}}"""
        val prf = WebauthnPlugin.flattenPrfOutput(input).getJSONObject("prf")
        assertTrue(prf.getBoolean("enabled"))
    }

    @Test
    fun flattenExtractsFirstAndSecondAfterAuthentication() {
        val input = """{"clientExtensionResults":{"prf":{"results":{"first":"Rmly","second":"U2Vjb"}}}}"""
        val prf = WebauthnPlugin.flattenPrfOutput(input).getJSONObject("prf")
        assertEquals("Rmly", prf.getString("first"))
        assertEquals("U2Vjb", prf.getString("second"))
    }

    @Test
    fun flattenOmitsSecondWhenOnlyFirstPresent() {
        val input = """{"clientExtensionResults":{"prf":{"results":{"first":"Rmly"}}}}"""
        val prf = WebauthnPlugin.flattenPrfOutput(input).getJSONObject("prf")
        assertEquals("Rmly", prf.getString("first"))
        assertFalse(prf.has("second"))
    }

    @Test
    fun `flattenPrfOutput lifts prf results to the top level`() {
        val response =
            WebauthnPlugin.flattenPrfOutput(
                """{"id":"cred","clientExtensionResults":{"prf":{"results":{"first":"c2VjcmV0"}}}}""",
            )
        val prf = response.getJSONObject("prf")
        assertEquals("c2VjcmV0", prf.getString("first"))
    }
}
