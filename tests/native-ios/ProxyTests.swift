import Foundation
import Pondnet

@main struct ProxyTests {
  static func main() async throws {
    for address in ["http://100.64.0.10:4443", "https://100.64.0.10:4443", "http://[fd7a:115c:a1e0::1]:4443", "https://[fd7a:115c:a1e0::1]:4443"] {
      precondition(PondURLProtocol.canInit(with: URLRequest(url: URL(string: address)!)), "Embedded request bypassed native enforcement")
    }
    precondition(!PondURLProtocol.canInit(with: URLRequest(url: URL(string: "https://example.com")!)), "Unrelated platform validation was intercepted")
    let directory = URL(fileURLWithPath: CommandLine.arguments[1])
    let pin = try String(contentsOf: directory.appendingPathComponent("pin.txt"), encoding: .utf8)
    let base = "https://100.64.0.10:4443"
    let other = "https://100.64.0.11:4443"
    let profile = "proxy-test-" + UUID().uuidString
    let second = profile + "-b"
    let control = "https://coordinator.invalid"
    defer {
      PondNetwork.disable()
      for id in [profile, second] {
        if let root = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false) {
          try? FileManager.default.removeItem(at: root.appendingPathComponent("pond-network").appendingPathComponent(id))
        }
      }
    }
    try PondURLProtocol.configure([["url": base, "pin": pin], ["url": other, "pin": pin]])
    func expectStopped() throws {
      precondition(!fixtureRunning, "failed activation leaked a running node")
      do {
        try PondNetwork.apply(URLSessionConfiguration.ephemeral, url: URL(string: base)!)
        fatalError("remote request permitted without a proxy")
      } catch {}
    }
    for step in ["start", "configuration", "targets", "status"] {
      fixtureFail(step)
      do { _ = try PondNetwork.stage(profile, control); fatalError("activation failure was ignored") } catch {}
      try expectStopped()
    }
    fixtureFail("")
    try PondNetwork.activate(profile, control)
    let starts = fixtureStarts
    try PondNetwork.activate(profile, control)
    precondition(fixtureStarts == starts, "same-profile activation restarted networking")
    let sessions = [URLSession(configuration: PondURLProtocol.configuration()), URLSession(configuration: PondURLProtocol.configuration())]
    defer { sessions.forEach { $0.invalidateAndCancel() } }
    func request(_ path: String, origin: String = base, index: Int = 0) async throws -> Data {
      var value = URLRequest(url: URL(string: origin + path)!)
      value.timeoutInterval = 5
      value.setValue("1", forHTTPHeaderField: "X-Pond-Transport")
      value.setValue("Bearer fixture-only", forHTTPHeaderField: "Authorization")
      let (data, response) = try await sessions[index].data(for: value)
      precondition((response as? HTTPURLResponse)?.statusCode == 200)
      return data
    }
    if CommandLine.arguments.count > 2 {
      for index in 0..<2 {
        do { _ = try await request("/expired", index: index); fatalError("expired certificate accepted through proxy") } catch {}
      }
      print("PASS expired certificate rejected through CONNECT by both native clients")
      return
    }
    for (index, path) in ["/fetch", "/xhr", "/sse"].enumerated() {
      let data = try await request(path, index: index % 2)
      precondition(String(decoding: data, as: UTF8.self).contains("first"))
      if path == "/sse" { precondition(String(decoding: data, as: UTF8.self).contains("second")) }
    }
    do { _ = try await request("/hostname", origin: other); fatalError("hostname mismatch accepted") } catch {}
    try PondURLProtocol.configure([["url": base, "pin": "sha256/" + Data(repeating: 0, count: 32).base64EncodedString()]])
    for index in 0..<2 {
      do { _ = try await request("/wrong-pin", index: index); fatalError("incorrect pin accepted") } catch {}
    }
    try PondURLProtocol.configure([["url": base, "pin": pin]])
    do { _ = try await request("/redirect"); fatalError("redirect accepted") } catch {}
    do { _ = try await request("/plaintext", origin: "http://100.64.0.10:4443"); fatalError("plaintext accepted") } catch {}
    _ = try PondNetwork.stage(second, control)
    try PondNetwork.cancel()
    precondition(fixtureStarts == starts + 2, "cancellation did not restore the active node")
    _ = try await request("/restored")
    // A rejected target update preserves the previous allowlist and trust profile.
    fixtureFail("targets")
    do { try PondURLProtocol.configure([["url": other, "pin": pin]]); fatalError("target failure accepted") } catch {}
    fixtureFail("")
    _ = try await request("/preserved")
    // Stop the proxy without changing the configured native endpoint. Neither
    // URLSession client may fall back to an OS VPN or a direct connection.
    MobileStop()
    for index in 0..<2 {
      do { _ = try await request("/unavailable", index: index); fatalError("unavailable proxy bypassed") } catch {}
    }
    PondNetwork.disable()
    try expectStopped()
    print("PASS activation cleanup, authenticated CONNECT, two clients, SSE, pin/hostname, redirect/plaintext, profile restoration and unavailable-proxy rejection")
  }
}
