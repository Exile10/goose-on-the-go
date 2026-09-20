internal import Expo
import Foundation
import React

@objc(PondTls)
final class PondTls: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @MainActor static func install() {
    RCTSetCustomNSURLSessionConfigurationProvider { PondURLProtocol.configuration() }
    ExpoFetchCustomExtension.setCustomURLSessionConfigurationProvider {
      PondURLProtocol.configuration()
    }
  }

  private let remoteQueue = DispatchQueue(label: "io.jarida.pond.remote")
  private func remote(_ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock, _ action: @escaping () throws -> Any?) {
    remoteQueue.async {
      defer { PondURLProtocol.invalidateConnections() }
      do { let result = try action(); resolve(result) }
      catch { reject("pond_remote_unavailable", "Remote access operation failed", nil) }
    }
  }
  @objc(beginRemote:control:resolver:rejecter:)
  func beginRemote(_ profile: String, control: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) { remote(resolve, reject) { try PondNetwork.stage(profile, control) } }
  @objc(remoteStatus:rejecter:)
  func remoteStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    remoteQueue.async { do { resolve(try PondNetwork.status()) } catch { reject("pond_remote_unavailable", "Remote access status unavailable", nil) } }
  }
  @objc(activateRemote:control:resolver:rejecter:)
  func activateRemote(_ profile: String, control: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) { remote(resolve, reject) { try PondNetwork.activate(profile, control); return nil } }
  @objc(cancelRemote:rejecter:)
  func cancelRemote(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) { remote(resolve, reject) { try PondNetwork.cancel(); return nil } }
  @objc(disableRemote:rejecter:)
  func disableRemote(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) { remote(resolve, reject) { PondNetwork.disable(); return nil } }

  @objc(configure:resolver:rejecter:)
  func configure(
    _ entries: [[String: String]], resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      try PondURLProtocol.configure(entries)
      resolve(nil)
    } catch { reject("pond_tls_configuration", "Invalid Pond trust configuration", error) }
  }

  @objc(trustFailed:resolver:rejecter:)
  func trustFailed(
    _ text: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(URL(string: text).map(PondURLProtocol.trustFailed) ?? true)
  }
}
