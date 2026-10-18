import CoreBluetooth
import Foundation
import React

/// A byte pipe to one Pond over its BLE setup service: scanning, one connection, notifications in,
/// writes with response out. Framing, the exchange and sealing are JavaScript's
/// (services/setup-channel). Nothing here bonds; the Pond's channel is secured above GATT.
@objc(PondBle)
final class PondBle: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate {
  private let queue = DispatchQueue(label: "io.jarida.pond.ble")
  // Made on first use, because making it is what shows iOS's Bluetooth prompt.
  private var central: CBCentralManager?
  private var stateWaiters: [RCTPromiseResolveBlock] = []
  private var listening = false
  private var seen: [UUID: CBPeripheral] = [:]
  private var lastReport: [UUID: Date] = [:]
  private var names: [UUID: String] = [:]
  private var services: [UUID: [String]] = [:]
  private var scanBase: [UInt8]?
  private var scanMask: [UInt8]?
  private var link: Link?

  private final class Link {
    let peripheral: CBPeripheral
    let service: CBUUID
    let rxUUID: CBUUID
    let txUUID: CBUUID
    var rx: CBCharacteristic?
    var connecting: (RCTPromiseResolveBlock, RCTPromiseRejectBlock)?
    var writing: (RCTPromiseResolveBlock, RCTPromiseRejectBlock)?
    var closed = false
    init(peripheral: CBPeripheral, service: CBUUID, rx: CBUUID, tx: CBUUID) {
      self.peripheral = peripheral
      self.service = service
      self.rxUUID = rx
      self.txUUID = tx
    }
  }

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! {
    ["PondBleState", "PondBleDiscovered", "PondBleScanFailed", "PondBleData", "PondBleDisconnected"]
  }
  override func startObserving() { listening = true }
  override func stopObserving() { listening = false }

  private func emit(_ name: String, _ body: [String: Any]) {
    if listening { sendEvent(withName: name, body: body) }
  }

  private func manager() -> CBCentralManager {
    if let central { return central }
    let made = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionShowPowerAlertKey: false])
    central = made
    return made
  }

  private func describe(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "on"
    case .poweredOff: return "off"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    default: return "unknown"
    }
  }

  @objc(state:rejecter:)
  func state(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      let central = self.manager()
      if central.state == .unknown || central.state == .resetting {
        self.stateWaiters.append(resolve)
      } else {
        resolve(self.describe(central.state))
      }
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    let state = describe(central.state)
    if central.state != .unknown && central.state != .resetting {
      let waiters = stateWaiters
      stateWaiters = []
      waiters.forEach { $0(state) }
    }
    if central.state != .poweredOn, let link { fail(link, "bluetooth_\(state)") }
    emit("PondBleState", ["state": state])
  }

  // With a mask, every UUID matching `service` under it: how one scan hears every card id.
  @objc(startScan:mask:resolver:rejecter:)
  func startScan(_ service: String, mask: String?, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      let central = self.manager()
      guard central.state == .poweredOn else { reject("pond_ble_unavailable", self.describe(central.state), nil); return }
      self.lastReport = [:]
      self.names = [:]
      self.services = [:]
      self.scanBase = Array(CBUUID(string: service).data)
      self.scanMask = mask.map { Array(CBUUID(string: $0).data) }
      // CoreBluetooth filters only on whole UUIDs, so a masked scan hears everything and keeps the
      // matches below; that works only in the foreground. Duplicates on, for the signal and a late name.
      let filter = mask == nil ? [CBUUID(string: service)] : nil
      central.scanForPeripherals(withServices: filter, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
      resolve(nil)
    }
  }

  @objc(stopScan:rejecter:)
  func stopScan(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      if let central = self.central, central.state == .poweredOn { central.stopScan() }
      resolve(nil)
    }
  }

  private func matches(_ uuid: CBUUID) -> Bool {
    guard let base = scanBase else { return false }
    let bytes = Array(uuid.data)
    guard bytes.count == 16, base.count == 16 else { return false }
    guard let mask = scanMask, mask.count == 16 else { return bytes == base }
    return (0..<16).allSatisfy { bytes[$0] & mask[$0] == base[$0] & mask[$0] }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let id = peripheral.identifier
    let advertised = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
      + (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
    let heard = advertised.filter(matches).map { $0.uuidString.lowercased() }
    if !heard.isEmpty {
      services[id] = heard
    } else if scanMask == nil, services[id] == nil, let base = scanBase {
      // A scan for one whole UUID only reports advertisers of it, even when iOS leaves the list out.
      services[id] = [CBUUID(data: Data(base)).uuidString.lowercased()]
    }
    guard let uuids = services[id] else { return }
    seen[id] = peripheral
    // The advertised local name, never `peripheral.name`: a Mac's GAP name is its computer name.
    let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
    let firstName = localName != nil && names[id] == nil
    if let localName { names[id] = localName }
    let now = Date()
    if !firstName, let last = lastReport[id], now.timeIntervalSince(last) < 1 { return }
    lastReport[id] = now
    emit("PondBleDiscovered", ["id": id.uuidString, "name": names[id] ?? NSNull(), "services": uuids, "rssi": RSSI.intValue])
  }

  @objc(connect:service:rx:tx:resolver:rejecter:)
  func connect(_ id: String, service: String, rx: String, tx: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      let central = self.manager()
      guard central.state == .poweredOn else { reject("pond_ble_unavailable", self.describe(central.state), nil); return }
      guard let uuid = UUID(uuidString: id), let peripheral = self.seen[uuid] ?? central.retrievePeripherals(withIdentifiers: [uuid]).first else {
        reject("pond_ble_connect", "Unknown device", nil); return
      }
      central.stopScan()
      if let link = self.link { self.close(link, "replaced") }
      let next = Link(peripheral: peripheral, service: CBUUID(string: service), rx: CBUUID(string: rx), tx: CBUUID(string: tx))
      next.connecting = (resolve, reject)
      self.link = next
      peripheral.delegate = self
      central.connect(peripheral, options: nil)
      self.queue.asyncAfter(deadline: .now() + 15) { [weak next] in
        guard let next, next.connecting != nil else { return }
        self.fail(next, "timeout")
      }
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard let link, link.peripheral === peripheral else { return }
    peripheral.discoverServices([link.service])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard let link, link.peripheral === peripheral else { return }
    fail(link, "connect_failed")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard let link, link.peripheral === peripheral else { return }
    fail(link, error == nil ? "disconnected" : "lost")
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let link, link.peripheral === peripheral else { return }
    guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == link.service }) else { fail(link, "no_setup_service"); return }
    peripheral.discoverCharacteristics([link.rxUUID, link.txUUID], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let link, link.peripheral === peripheral else { return }
    let rx = service.characteristics?.first(where: { $0.uuid == link.rxUUID })
    guard error == nil, let rx, let tx = service.characteristics?.first(where: { $0.uuid == link.txUUID }) else {
      fail(link, "no_setup_service"); return
    }
    link.rx = rx
    peripheral.setNotifyValue(true, for: tx)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard let link, link.peripheral === peripheral, let pending = link.connecting else { return }
    guard error == nil, characteristic.isNotifying else { fail(link, "no_notify"); return }
    link.connecting = nil
    pending.0(["writeSize": peripheral.maximumWriteValueLength(for: .withResponse)])
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let link, link.peripheral === peripheral, !link.closed, characteristic.uuid == link.txUUID, error == nil, let value = characteristic.value else { return }
    emit("PondBleData", ["id": peripheral.identifier.uuidString, "value": value.base64EncodedString()])
  }

  @objc(write:value:resolver:rejecter:)
  func write(_ id: String, value: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      guard let link = self.link, !link.closed, link.peripheral.identifier.uuidString == id, let rx = link.rx else {
        reject("pond_ble_closed", "Not connected", nil); return
      }
      guard link.writing == nil else { reject("pond_ble_busy", "A write is in flight", nil); return }
      guard let data = Data(base64Encoded: value) else { reject("pond_ble_write", "Not base64", nil); return }
      link.writing = (resolve, reject)
      link.peripheral.writeValue(data, for: rx, type: .withResponse)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let link, link.peripheral === peripheral, let pending = link.writing else { return }
    link.writing = nil
    if let error { pending.1("pond_ble_write", error.localizedDescription, nil) } else { pending.0(nil) }
  }

  @objc(disconnect:resolver:rejecter:)
  func disconnect(_ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.async {
      if let link = self.link, link.peripheral.identifier.uuidString == id { self.close(link, "closed") }
      resolve(nil)
    }
  }

  private func fail(_ link: Link, _ reason: String) {
    link.connecting?.1("pond_ble_connect", reason, nil)
    link.connecting = nil
    close(link, reason)
  }

  private func close(_ link: Link, _ reason: String) {
    guard !link.closed else { return }
    link.closed = true
    link.writing?.1("pond_ble_closed", reason, nil)
    link.writing = nil
    if let central, central.state == .poweredOn { central.cancelPeripheralConnection(link.peripheral) }
    if self.link === link { self.link = nil }
    emit("PondBleDisconnected", ["id": link.peripheral.identifier.uuidString, "reason": reason])
  }

  override func invalidate() {
    queue.sync {
      if let central = self.central, central.state == .poweredOn { central.stopScan() }
      if let link = self.link { self.close(link, "invalidated") }
    }
    super.invalidate()
  }
}
