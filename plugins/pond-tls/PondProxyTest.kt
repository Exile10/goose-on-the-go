package io.jarida.pondtls

import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Credentials
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.BufferedReader
import java.io.BufferedWriter
import java.net.InetSocketAddress
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.TimeUnit

/** Run with tests/native-android/run_proxy.sh. The real Go CONNECT proxy dials a
 * loopback TLS fixture; enrollment and the JNI node lifecycle are tested elsewhere. */
class PondProxyTest {
  private var proxy: Process? = null
  private var input: BufferedWriter? = null
  private var output: BufferedReader? = null
  private var server: MockWebServer? = null
  private val origin = "https://100.64.0.10:4443"
  private fun field(name: String, value: Any?) {
    // Keep fixture credentials out of the production native/JS API. Only this
    // test substitutes the private endpoint ordinarily obtained through JNI.
    PondNetwork::class.java.getDeclaredField(name).apply { isAccessible = true }.set(null, value)
  }
  private fun hash(cert: HeldCertificate) = "sha256/" + Base64.getEncoder().encodeToString(
    MessageDigest.getInstance("SHA-256").digest(cert.certificate.publicKey.encoded))
  private fun start(cert: HeldCertificate, expected: String = hash(cert)) {
    val binary = System.getenv("POND_PROXY_FIXTURE_BIN")
    assumeTrue("Run run_proxy.sh to build the production Go CONNECT fixture", !binary.isNullOrEmpty())
    val tls = MockWebServer()
    tls.useHttps(HandshakeCertificates.Builder().heldCertificate(cert).build().sslSocketFactory(), false)
    tls.start(); server = tls
    PondTls.configurePins(mapOf(origin to expected)); PondTls.install()
    val process = ProcessBuilder(binary!!, "127.0.0.1:${tls.port}").start()
    proxy = process; input = process.outputStream.bufferedWriter(); output = process.inputStream.bufferedReader()
    val config = output!!.readLine()
    val address = Regex("\"address\":\"127\\.0\\.0\\.1:([0-9]+)\"").find(config)!!.groupValues[1].toInt()
    val secret = Regex("\"credential\":\"([A-Za-z0-9_-]+)\"").find(config)!!.groupValues[1]
    input!!.write("[\"100.64.0.10:4443\"]\n"); input!!.flush()
    assertEquals("{\"ok\":true}", output!!.readLine())
    field("proxyAddress", InetSocketAddress("127.0.0.1", address))
    field("credential", Credentials.basic("pond", secret))
  }
  private fun request(path: String = "/api/v1/health") = Request.Builder().url(origin + path)
    .header("X-Pond-Transport", "1").header("Authorization", "Bearer fixture-only").build()
  @After fun cleanup() {
    field("proxyAddress", null); field("credential", null)
    PondTls.configurePins(emptyMap())
    input?.close()
    proxy?.let { if (!it.waitFor(5, TimeUnit.SECONDS)) it.destroyForcibly() }
    server?.shutdown()
  }
  @Test fun bothClientsKeepPinnedTlsInsideAuthenticatedConnect() {
    start(HeldCertificate.Builder().addSubjectAlternativeName("100.64.0.10").build())
    repeat(2) {
      server!!.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: first\n\ndata: second\n\n"))
      OkHttpClientProvider.createClient().newCall(request("/sse")).execute().use { response ->
        assertEquals(200, response.code)
        assertTrue(response.body!!.string().contains("data: second"))
      }
      val received = server!!.takeRequest(2, TimeUnit.SECONDS)!!
      assertEquals("Bearer fixture-only", received.getHeader("Authorization"))
      assertNull(received.getHeader("Proxy-Authorization"))
      assertNull(received.getHeader("X-Pond-Transport"))
    }
  }
  @Test fun proxyDoesNotBypassIncorrectPin() {
    val cert = HeldCertificate.Builder().addSubjectAlternativeName("100.64.0.10").build()
    start(cert, hash(HeldCertificate.Builder().build()))
    repeat(2) { assertThrows(Exception::class.java) { OkHttpClientProvider.createClient().newCall(request()).execute() } }
    assertEquals(0, server!!.requestCount)
  }
  @Test fun proxyDoesNotBypassHostnameOrExpiry() {
    start(HeldCertificate.Builder().addSubjectAlternativeName("different.test").build())
    assertThrows(Exception::class.java) { OkHttpClientProvider.createClient().newCall(request()).execute() }
    assertEquals(0, server!!.requestCount)
    cleanup(); proxy = null; input = null; server = null
    start(HeldCertificate.Builder().addSubjectAlternativeName("100.64.0.10").validityInterval(1, 1000).build())
    assertThrows(Exception::class.java) { OkHttpClientProvider.createClient().newCall(request()).execute() }
    assertEquals(0, server!!.requestCount)
  }
  @Test fun redirectPlaintextAndUnavailableProxyFailClosed() {
    start(HeldCertificate.Builder().addSubjectAlternativeName("100.64.0.10").build())
    server!!.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "$origin/captured"))
    val client = OkHttpClientProvider.createClient().newBuilder().callTimeout(3, TimeUnit.SECONDS).build()
    assertThrows(Exception::class.java) { client.newCall(request("/redirect")).execute() }
    assertEquals(1, server!!.requestCount)
    assertThrows(Exception::class.java) { client.newCall(request().newBuilder().url("http://100.64.0.10:4443/plaintext").build()).execute() }
    input!!.close(); assertTrue(proxy!!.waitFor(5, TimeUnit.SECONDS)); input = null
    repeat(2) { assertThrows(Exception::class.java) { client.newCall(request("/unavailable")).execute() } }
    assertEquals(1, server!!.requestCount)
  }
}
