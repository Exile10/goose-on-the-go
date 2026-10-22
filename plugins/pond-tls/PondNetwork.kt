package io.jarida.pondtls

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.LinkProperties
import android.net.NetworkCapabilities
import io.jarida.mobile.Diagnostics
import io.jarida.mobile.InterfaceProvider
import java.net.NetworkInterface
import io.jarida.mobile.Mobile
import okhttp3.Credentials
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI

/** App-scoped networking. Proxy credentials never cross the React Native bridge. */
object PondNetwork {
  private lateinit var context: Context
  @Volatile private var proxyAddress: InetSocketAddress? = null
  @Volatile private var credential: String? = null
  @Volatile private var origins: Set<String> = emptySet()
  private var activeProfile: Pair<String, String>? = null
  private var runningProfile: Pair<String, String>? = null
  private var targets: List<String> = emptyList()

  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  /**
   * The state last handed to the foreground service.
   *
   * `status()` is polled once a second during enrollment, and re-delivering an unchanged
   * state would restart the service on every tick for no benefit.
   */
  private var announced: String? = null

  /**
   * Keep the foreground service in step with the node, so the notification cannot lie.
   *
   * An unchanged state is re-delivered only after the platform refused the service: the next
   * poll, which comes from the app returning to the foreground, is the moment a start can
   * succeed again.
   */
  private fun announce(raw: String) {
    val state = try { JSONObject(raw).optString("state") } catch (error: Exception) { "" }
    val next = if (state == PondNetworkService.STATE_RUNNING) PondNetworkService.STATE_RUNNING
               else PondNetworkService.STATE_CONNECTING
    if (next == announced && PondNetworkService.refusal == null) return
    announced = next
    PondNetworkService.start(context, next)
  }

  /**
   * The node's status, plus `"background": "unavailable"` while the platform refuses the
   * foreground service. The node itself is unaffected, so remote access keeps working while
   * the app is open; the field tells the app it will pause once the app is in the background.
   */
  private fun report(raw: String): String {
    if (announced == null || PondNetworkService.refusal == null) return raw
    return try { JSONObject(raw).put("background", "unavailable").toString() } catch (error: Exception) { raw }
  }
  fun install(value: Context) {
    context = value.applicationContext
    // The node's own diagnostic lines are always recorded. There are a handful
    // of them, they are redacted on the Go side, and they are the difference
    // between "the node did not connect" and "the first resolver refused TCP".
    // Requiring somebody to find a switch and reproduce the failure before the
    // reason is written down is how a field failure becomes undiagnosable.
    Mobile.setEventLog(object : Diagnostics {
      override fun log(line: String) { android.util.Log.i("PondNetwork", line) }
    })
    // Tailscale's backend log is a different thing: verbose, and it names
    // addresses and keys. That stays off unless asked for.
    if (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
      installDiagnostics()
    }
    pushResolvers()
    Mobile.setInterfaceProvider(object : InterfaceProvider {
      override fun getInterfaces(): String {
        val result = JSONArray()
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return result.toString()
        while (interfaces.hasMoreElements()) {
          val item = interfaces.nextElement()
          val addresses = JSONArray()
          item.interfaceAddresses.forEach { address ->
            val host = address.address.hostAddress?.substringBefore('%')
            if (host != null) addresses.put("$host/${address.networkPrefixLength}")
          }
          var flags = 0
          if (item.isUp) flags = flags or 1
          if (item.interfaceAddresses.any { it.broadcast != null }) flags = flags or 2
          if (item.isLoopback) flags = flags or 4
          if (item.isPointToPoint) flags = flags or 8
          if (item.supportsMulticast()) flags = flags or 16
          result.put(JSONObject().put("name", item.name).put("index", item.index)
            .put("mtu", item.mtu).put("flags", flags).put("addresses", addresses))
        }
        return result.toString()
      }
    })
  }
  private fun observeNetwork() {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) { changed() }
      override fun onLost(network: Network) { changed() }
      override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) { changed() }
      override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) { changed() }
      private fun changed() {
        // This callback never enters PondNetwork's lock: Go may call the native
        // interface getter while starting/stopping the node on another thread.
        val name = manager.activeNetwork?.let { manager.getLinkProperties(it)?.interfaceName } ?: ""
        pushResolvers()
        Mobile.networkChanged(name)
      }
    }
    manager.registerDefaultNetworkCallback(callback)
    networkCallback = callback
    val name = manager.activeNetwork?.let { manager.getLinkProperties(it)?.interfaceName } ?: ""
    Mobile.networkChanged(name)
  }
  /**
   * Hand the node the resolvers the OS reports for the active network.
   *
   * The platform resolver does not answer for the embedded node: a lookup of the
   * coordinator hangs and then falls through to Tailscale's bootstrap DNS, which
   * cannot answer for a self-hosted coordinator and discloses its hostname while
   * asking. These are pushed rather than fetched on demand, because a lookup must
   * not wait on a call back into Java.
   */
  /**
   * Route tailscale's backend logging to logcat.
   *
   * Backend logging is discarded in a release build, so a node that cannot
   * reach its control server fails with nothing to look at. That is exactly
   * the situation worth diagnosing, and it is the one where nobody can attach
   * a debuggable build -- it happens on a particular carrier, in a particular
   * place, to somebody who is not holding a laptop.
   *
   * The lines are redacted on the Go side before they arrive here: the backend
   * announces the node-authorisation URL in plain text, and that URL is a
   * bearer capability for joining this household. It must not reach a log, and
   * `authURLPattern` in node.go is what keeps it out.
   *
   * Off unless asked for, and not remembered across a restart: diagnostics that
   * quietly stay on are a log nobody knows they are writing.
   */
  @Synchronized fun installDiagnostics() {
    Mobile.setDiagnostics(object : Diagnostics {
      override fun log(line: String) { android.util.Log.i("PondNetwork", line) }
    })
  }

  private fun pushResolvers() {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val servers = manager.activeNetwork?.let { manager.getLinkProperties(it) }?.dnsServers.orEmpty()
    val result = JSONArray()
    val seen = mutableSetOf<String>()
    // Keep the order the OS gave: on a home network the server it lists first is
    // typically the one that answers, and the node tries them in order.
    for (address in servers) {
      if (address.isLoopbackAddress || address.isAnyLocalAddress || address.isMulticastAddress) continue
      var host = address.hostAddress?.substringBefore('%') ?: continue
      if (address is Inet6Address && address.isLinkLocalAddress) {
        // A link-local server needs a zone, and it must be the numeric scope:
        // resolving an interface name needs netlink, which this platform denies
        // to applications. Without one the node cannot dial it at all.
        val scope = address.scopeId
        if (scope == 0) continue
        host = "$host%$scope"
      }
      if (seen.add(host)) result.put(host)
    }
    Mobile.setResolvers(result.toString())
  }
  private fun origin(url: HttpUrl) = "https://${url.host}:${url.port}"
  private fun remote(host: String): Boolean {
    // Exactly four all-digit labels. Dropping the labels that do not parse let
    // "100.64.0.1.attacker.example" pass as a tailnet address.
    val parts = host.split('.')
    val bytes = parts.mapNotNull { p -> if (p.length in 1..3 && p.all { it in '0'..'9' }) p.toInt() else null }
    // Tailscale's own service address (MagicDNS and the local API) is never a Pond, and
    // proxying to it would hand the page a way to query this node's resolver.
    if (bytes == listOf(100, 100, 100, 100) || host.lowercase() in setOf("fd7a:115c:a1e0::53", "fd7a:115c:a1e0:0:0:0:0:53")) return false
    return (parts.size == 4 && bytes.size == 4 && bytes.all { it in 0..255 } && bytes[0] == 100 && bytes[1] in 64..127) || host.lowercase().startsWith("fd7a:115c:a1e0:")
  }
  @Synchronized fun configure(urls: Collection<HttpUrl>) {
    val nextOrigins = urls.filter { it.isHttps && remote(it.host) }.map(::origin).toSet()
    val nextTargets = urls.filter { it.isHttps && remote(it.host) }.map { if (it.host.contains(':')) "[${it.host}]:${it.port}" else "${it.host}:${it.port}" }
    if (proxyAddress != null) Mobile.setTargets(JSONArray(nextTargets).toString())
    origins = nextOrigins
    targets = nextTargets
  }
  @Synchronized fun stage(profile: String, control: String): String {
    require(profile.matches(Regex("[A-Za-z0-9_-]{1,100}")))
    require(control.startsWith("https://"))
    stopTransport()
    var started = false
    try {
      val base = java.io.File(context.noBackupFilesDir, "pond-network")
      check(base.isDirectory || base.mkdir())
      val directory = java.io.File(base, profile)
      Mobile.start(directory.absolutePath, "goose-on-the-go", control)
      val config = JSONObject(Mobile.proxyConfiguration())
      val parts = config.getString("address").split(':')
      require(parts.size == 2 && parts[0] == "127.0.0.1")
      val port = parts[1].toInt()
      require(port in 1..65535)
      val secret = config.getString("credential")
      require(secret.isNotEmpty())
      proxyAddress = InetSocketAddress(parts[0], port)
      credential = Credentials.basic("pond", secret)
      runningProfile = Pair(profile, control)
      Mobile.setTargets(JSONArray(targets).toString())
      observeNetwork()
      val result = Mobile.status()
      started = true
      announce(result)
      return result
    } finally {
      if (!started) stopTransport()
      PondTls.invalidateConnections()
    }
  }
  @Synchronized fun status(): String {
    val raw = Mobile.status()
    announce(raw)
    return report(raw)
  }
  @Synchronized fun activate(profile: String, control: String) {
    val previous = activeProfile?.first ?: runningProfile?.first
    activeProfile = if (control.isEmpty()) null else Pair(profile, control)
    if (activeProfile == null) { stopTransport(); previous?.let(::forgetNetworkMap) }
    else if (runningProfile != activeProfile || proxyAddress == null) {
      try { stage(profile, control) }
      catch (error: Exception) { stopTransport(); throw error }
    }
    pruneSupersededIdentities(profile)
    PondTls.invalidateConnections()
  }
  /**
   * The app keeps one pairing at a time, so once [keep] is the active profile every other
   * node directory belongs to a pairing it replaced or forgot, and each still holds that
   * node's private key. A forgotten pairing passes an empty profile and keeps none.
   * Called only after the profile's node started, or was stopped for want of a coordinator,
   * so a failed start never costs the identity it was meant to use. The Go side refuses a
   * directory whose node lock is held, and reports what it erased and what it could not.
   */
  private fun pruneSupersededIdentities(keep: String) {
    val base = java.io.File(context.noBackupFilesDir, "pond-network")
    try { Mobile.prune(base.absolutePath, keep) }
    catch (error: Exception) { android.util.Log.w("PondNetwork", "superseded node identities were not all erased: ${error.message}") }
  }
  @Synchronized fun cancel() {
    val active = activeProfile
    if (active == null) stopTransport() else if (runningProfile != active) stage(active.first, active.second)
    PondTls.invalidateConnections()
  }
  @Synchronized fun disable() {
    val previous = activeProfile?.first ?: runningProfile?.first
    activeProfile = null
    stopTransport()
    previous?.let(::forgetNetworkMap)
    PondTls.invalidateConnections()
  }
  /**
   * Remote access is off for this profile, by choice or because the Pond forgot the phone,
   * so the network map the node cached -- its peers, their addresses, the access rules --
   * has no reason to stay on the phone. Leaving local-only ("keep local only") and a
   * forgotten pairing both arrive here through activate with no coordinator.
   */
  private fun forgetNetworkMap(profile: String) {
    val directory = java.io.File(java.io.File(context.noBackupFilesDir, "pond-network"), profile)
    try { Mobile.disable(directory.absolutePath) }
    catch (error: Exception) { android.util.Log.w("PondNetwork", "remote access is off but its cached network map was not erased: ${error.message}") }
  }
  /**
   * Erase every node identity, so the next [stage] starts a node with fresh keys.
   *
   * For a pairing whose remote access lapsed: the Pond revoked its enrollment, and the
   * coordinator keeps the revoked machine key as a tombstone it will never enrol again, so
   * only a new key brings remote access back. The node is stopped first, because the Go side
   * refuses a directory whose node lock is held, and the active profile is forgotten, so
   * neither [activate] nor [cancel] restarts a node from the identity being erased. The app
   * keeps one pairing at a time, so no directory is kept. A failure is logged and rethrown.
   */
  @Synchronized fun resetIdentity() {
    activeProfile = null
    stopTransport()
    PondTls.invalidateConnections()
    val base = java.io.File(context.noBackupFilesDir, "pond-network")
    try { Mobile.prune(base.absolutePath, "") }
    catch (error: Exception) {
      android.util.Log.w("PondNetwork", "node identities were not erased: ${error.message}")
      throw error
    }
  }
  private fun stopTransport() {
    networkCallback?.let { callback ->
      val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      manager.unregisterNetworkCallback(callback)
    }
    networkCallback = null
    proxyAddress = null; credential = null; runningProfile = null; Mobile.stop()
    // A local-only profile never starts the node, so it never sees the notification.
    announced = null
    PondNetworkService.stop(context)
  }
  fun requireAvailable(url: HttpUrl) {
    if (origin(url) in origins && proxyAddress == null) throw IOException("Embedded remote access is unavailable")
  }
  fun proxyCredential(proxy: Proxy?): String? = if (proxy?.address() == proxyAddress) credential else null
  fun selector(fallback: ProxySelector?): ProxySelector = object : ProxySelector() {
    override fun select(uri: URI): MutableList<Proxy> {
      if ("https://${uri.host}:${if (uri.port == -1) 443 else uri.port}" in origins) {
        val address = proxyAddress ?: throw IllegalStateException("Embedded remote access is unavailable")
        return mutableListOf(Proxy(Proxy.Type.HTTP, address))
      }
      return fallback?.select(uri) ?: mutableListOf(Proxy.NO_PROXY)
    }
    override fun connectFailed(uri: URI, address: SocketAddress, error: IOException) { fallback?.connectFailed(uri, address, error) }
  }
}
