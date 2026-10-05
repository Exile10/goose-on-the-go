import Foundation
import Network
import Pondnet

/// Owns the application-scoped node. Credentials are never exported to JavaScript.
final class PondNetwork {
  private static let lock = NSRecursiveLock()
  private static var port: Int?
  private static var password: String?
  private static var activeProfile: [String]?
  private static var runningProfile: [String]?
  private static var targets: [String] = []

  private static func checked<T>(_ action: (AutoreleasingUnsafeMutablePointer<NSError?>) -> T) throws -> T {
    var error: NSError?
    let result = action(&error)
    if let error { throw error }
    return result
  }
  static func remote(_ value: String) -> Bool {
    let host = value.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    // Exactly four all-digit labels. Dropping the labels that do not parse let
    // "100.64.0.1.attacker.example" pass as a tailnet address.
    let parts = host.split(separator: ".", omittingEmptySubsequences: false)
    let bytes = parts.compactMap { part -> Int? in
      guard (1...3).contains(part.count), part.allSatisfy({ ("0"..."9").contains($0) }) else { return nil }
      return Int(part)
    }
    return (parts.count == 4 && bytes.count == 4 && bytes.allSatisfy { (0...255).contains($0) } && bytes[0] == 100 && (64...127).contains(bytes[1])) || host.lowercased().hasPrefix("fd7a:115c:a1e0:")
  }
  static func configure(_ origins: [String]) throws {
    lock.lock(); defer { lock.unlock() }
    let next: [String] = origins.compactMap { text in
      guard let url = URL(string: text), let host = url.host, remote(host) else { return nil }
      return "\(host.contains(":") ? "[\(host)]" : host):\(url.port ?? 443)"
    }
    if port != nil { try applyTargets(next) }
    targets = next
  }
  private static func applyTargets(_ values: [String]) throws {
    let data = try JSONSerialization.data(withJSONObject: values)
    _ = try checked { MobileSetTargets(String(decoding: data, as: UTF8.self), $0) }
  }
  static func stage(_ profile: String, _ control: String) throws -> String {
    lock.lock(); defer { lock.unlock() }
    guard profile.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil else { throw URLError(.badURL) }
    stop()
    var started = false
    defer { if !started { stop() } }
    var directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("pond-network", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    directory = directory.appendingPathComponent(profile, isDirectory: true)
    _ = try checked { MobileStart(directory.path, "goose-on-the-go", control, $0) }
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    let text = try checked { MobileProxyConfiguration($0) }
    guard let data = text.data(using: .utf8), let config = try JSONSerialization.jsonObject(with: data) as? [String: String],
      let address = config["address"], address.hasPrefix("127.0.0.1:"),
      let number = Int(address.dropFirst("127.0.0.1:".count)), (1...65535).contains(number), let secret = config["credential"], !secret.isEmpty
    else { stop(); throw URLError(.cannotConnectToHost) }
    port = number; password = secret; runningProfile = [profile, control]
    try applyTargets(targets)
    let result = try checked { MobileStatus($0) }
    started = true
    return result
  }
  static func status() throws -> String { lock.lock(); defer { lock.unlock() }; return try checked { MobileStatus($0) } }
  static func activate(_ profile: String, _ control: String) throws {
    lock.lock(); defer { lock.unlock() }
    let previous = activeProfile?.first ?? runningProfile?.first
    activeProfile = control.isEmpty ? nil : [profile, control]
    guard let active = activeProfile else { stop(); forgetNetworkMap(previous); return }
    if runningProfile != active || port == nil {
      do { _ = try stage(active[0], active[1]) } catch { stop(); throw error }
    }
  }
  static func cancel() throws {
    lock.lock(); defer { lock.unlock() }
    guard let active = activeProfile else { stop(); return }
    if runningProfile != active { _ = try stage(active[0], active[1]) }
  }
  static func disable() {
    lock.lock(); defer { lock.unlock() }
    let previous = activeProfile?.first ?? runningProfile?.first
    activeProfile = nil; stop(); forgetNetworkMap(previous)
  }
  /// Remote access is off for this profile, by choice or because the Pond forgot the phone, so
  /// the network map the node cached -- its peers, their addresses, the access rules -- has no
  /// reason to stay on the phone. Leaving local-only and a forgotten pairing both arrive here
  /// through activate with no coordinator.
  private static func forgetNetworkMap(_ profile: String?) {
    guard let profile, let base = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false) else { return }
    let directory = base.appendingPathComponent("pond-network", isDirectory: true).appendingPathComponent(profile, isDirectory: true)
    do { _ = try checked { MobileDisable(directory.path, $0) } }
    catch { NSLog("PondNetwork: remote access is off but its cached network map was not erased: %@", String(describing: error)) }
  }
  private static func stop() { port = nil; password = nil; runningProfile = nil; MobileStop() }

  static func apply(_ config: URLSessionConfiguration, url: URL) throws {
    lock.lock(); defer { lock.unlock() }
    guard let host = url.host, remote(host) else { return }
    guard let port, let password else { throw URLError(.cannotConnectToHost) }
    if #available(iOS 17.0, *) {
      var proxy = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: UInt16(port))!))
      proxy.allowFailover = false
      proxy.applyCredential(username: "pond", password: password)
      config.proxyConfigurations = [proxy]
    } else {
      config.connectionProxyDictionary = ["HTTPEnable": 1, "HTTPProxy": "127.0.0.1", "HTTPPort": port,
        "HTTPSEnable": 1, "HTTPSProxy": "127.0.0.1", "HTTPSPort": port]
    }
  }
  static func proxyCredential(_ space: URLProtectionSpace) -> URLCredential? {
    lock.lock(); defer { lock.unlock() }
    guard space.isProxy(), space.host == "127.0.0.1", space.port == port, let password,
      space.authenticationMethod == NSURLAuthenticationMethodHTTPBasic else { return nil }
    return URLCredential(user: "pond", password: password, persistence: .forSession)
  }
}
