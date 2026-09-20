import Foundation

// Test-only binding double: the node lifecycle is controlled here, while CONNECT
// and tunnel invalidation run in the production Go proxy in a child process.
private var child: Process?
private var input: FileHandle?
private var output: FileHandle?
private var configuration = ""
private var failure = ""
public private(set) var fixtureStarts = 0
public var fixtureRunning: Bool { child?.isRunning == true }
public func fixtureFail(_ step: String) { failure = step }

private func fail(_ step: String, _ error: AutoreleasingUnsafeMutablePointer<NSError?>) -> Bool {
  guard failure == step else { return false }
  error.pointee = NSError(domain: "PondFixture", code: 1)
  return true
}
private func line() -> String {
  var data = Data()
  while let byte = try? output?.read(upToCount: 1), !byte.isEmpty {
    if byte == Data([10]) { break }
    data.append(byte)
  }
  return String(decoding: data, as: UTF8.self)
}
public func MobileStart(_ directory: String, _ hostname: String, _ control: String, _ error: AutoreleasingUnsafeMutablePointer<NSError?>) -> Bool {
  if fail("start", error) { return false }
  do {
    try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
    let process = Process()
    process.executableURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["POND_PROXY_FIXTURE_BIN"]!)
    process.arguments = [ProcessInfo.processInfo.environment["POND_PROXY_FIXTURE_UPSTREAM"]!]
    let incoming = Pipe(), outgoing = Pipe()
    process.standardInput = incoming; process.standardOutput = outgoing
    try process.run()
    child = process; input = incoming.fileHandleForWriting; output = outgoing.fileHandleForReading
    configuration = line()
    fixtureStarts += 1
    return true
  } catch let problem { error.pointee = problem as NSError; return false }
}
public func MobileStop() {
  try? input?.close(); input = nil
  child?.waitUntilExit(); child = nil
  try? output?.close(); output = nil
  configuration = ""
}
public func MobileProxyConfiguration(_ error: AutoreleasingUnsafeMutablePointer<NSError?>) -> String {
  if fail("configuration", error) { return "" }
  return configuration
}
public func MobileSetTargets(_ targets: String, _ error: AutoreleasingUnsafeMutablePointer<NSError?>) -> Bool {
  if fail("targets", error) { return false }
  do {
    try input?.write(contentsOf: Data((targets + "\n").utf8))
    let response = try JSONSerialization.jsonObject(with: Data(line().utf8)) as? [String: Bool]
    if response?["ok"] != true { throw URLError(.badURL) }
    return true
  } catch let problem { error.pointee = problem as NSError; return false }
}
public func MobileStatus(_ error: AutoreleasingUnsafeMutablePointer<NSError?>) -> String {
  if fail("status", error) { return "" }
  return "{\"state\":\"\(fixtureRunning ? "Running" : "Stopped")\",\"addresses\":[]}"
}
