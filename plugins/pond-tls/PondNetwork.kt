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
  fun install(value: Context) {
    context = value.applicationContext
    // Backend logging is discarded in a release build, so a node that cannot
    // reach its control server fails with nothing to look at. A debuggable build
    // routes those lines to logcat instead. They are redacted on the Go side:
    // the backend announces the enrollment URL in plain text and that capability
    // must not reach a log.
    if (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
      Mobile.setDiagnostics(object : Diagnostics {
        override fun log(line: String) { android.util.Log.i("PondNetwork", line) }
      })
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
    val bytes = host.split('.').mapNotNull { it.toIntOrNull() }
    return (bytes.size == 4 && bytes.all { it in 0..255 } && bytes[0] == 100 && bytes[1] in 64..127) || host.lowercase().startsWith("fd7a:115c:a1e0:")
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
      return result
    } finally {
      if (!started) stopTransport()
      PondTls.invalidateConnections()
    }
  }
  @Synchronized fun status(): String = Mobile.status()
  @Synchronized fun activate(profile: String, control: String) {
    activeProfile = if (control.isEmpty()) null else Pair(profile, control)
    if (activeProfile == null) { stopTransport() }
    else if (runningProfile != activeProfile || proxyAddress == null) {
      try { stage(profile, control) }
      catch (error: Exception) { stopTransport(); throw error }
    }
    PondTls.invalidateConnections()
  }
  @Synchronized fun cancel() {
    val active = activeProfile
    if (active == null) stopTransport() else if (runningProfile != active) stage(active.first, active.second)
    PondTls.invalidateConnections()
  }
  @Synchronized fun disable() { activeProfile = null; stopTransport(); PondTls.invalidateConnections() }
  private fun stopTransport() {
    networkCallback?.let { callback ->
      val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      manager.unregisterNetworkCallback(callback)
    }
    networkCallback = null
    proxyAddress = null; credential = null; runningProfile = null; Mobile.stop()
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
