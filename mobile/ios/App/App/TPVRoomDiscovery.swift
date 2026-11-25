import Foundation
import Capacitor

@objc(TPVRoomDiscoveryPlugin)
public class TPVRoomDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin, NetServiceBrowserDelegate, NetServiceDelegate {
    public let identifier = "TPVRoomDiscoveryPlugin"
    public let jsName = "TPVRoomDiscovery"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "advertise", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)]
    private var browser: NetServiceBrowser?
    private var advertisement: NetService?
    private var pending: CAPPluginCall?
    private var services: [NetService] = []
    private var rooms: [[String: String]] = []
    private var timeout: DispatchWorkItem?
    private var scanGeneration: UInt64 = 0
    private func valid(_ value: String) -> Bool {
        guard let url = URL(string: value), url.scheme == "https", url.host == "queue.thepropervolume.com", url.port == nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return false }
        return url.path.range(of: "^/[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$", options: .regularExpression) != nil
    }
    @objc func discover(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("Discovery is already running."); return }
            self.scanGeneration &+= 1; let generation = self.scanGeneration
            self.pending = call; self.rooms = []; self.services = []
            let browser = NetServiceBrowser(); self.browser = browser; browser.delegate = self
            browser.searchForServices(ofType: "_tpv-karaoke._tcp.", inDomain: "local.")
            let timeout = DispatchWorkItem { self.finish(generation: generation) }; self.timeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: timeout)
        }
    }
    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard browser === self.browser, pending != nil, services.count < 20 else { return }
        services.append(service); service.delegate = self; service.resolve(withTimeout: 5)
    }
    public func netServiceDidResolveAddress(_ sender: NetService) {
        guard pending != nil, services.contains(where: { $0 === sender }), let data = sender.txtRecordData(), let urlData = NetService.dictionary(fromTXTRecord: data)["url"], urlData.count <= 200,
              let url = String(data: urlData, encoding: .utf8), valid(url), !rooms.contains(where: { $0["url"] == url }) else { return }
        rooms.append(["url": url, "name": String(sender.name.prefix(100))])
    }
    public func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        guard browser === self.browser else { return }; finish(generation: scanGeneration)
    }
    private func finish(generation: UInt64) {
        guard generation == scanGeneration else { return }; scanGeneration &+= 1
        timeout?.cancel(); timeout = nil; browser?.delegate = nil; browser?.stop(); browser = nil
        services.forEach { $0.delegate = nil; $0.stop() }; services = []
        pending?.resolve(["rooms": rooms]); pending = nil
    }
    /** DNS labels are limited by UTF-8 bytes; keep complete Unicode characters. */
    private func serviceLabel(_ input: String) -> String {
        let clean = input.replacingOccurrences(of: ".", with: "-").components(separatedBy: .controlCharacters).joined(separator: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        var result = "", bytes = 0
        for character in clean {
            let length = String(character).utf8.count
            if bytes + length > 63 { break }
            result.append(character); bytes += length
        }
        let label = result.trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty ? "TPV Karaoke" : label
    }
    @objc func advertise(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), valid(url) else { call.reject("Invalid room address."); return }
        let name = serviceLabel(call.getString("name") ?? "TPV Karaoke")
        DispatchQueue.main.async {
            self.advertisement?.stop()
            let service = NetService(domain: "local.", type: "_tpv-karaoke._tcp.", name: name, port: 443)
            service.setTXTRecord(NetService.data(fromTXTRecord: ["url": Data(url.utf8)])); service.publish(); self.advertisement = service; call.resolve()
        }
    }
    @objc func stop(_ call: CAPPluginCall) { DispatchQueue.main.async { self.advertisement?.stop(); self.advertisement = nil; call.resolve() } }
    deinit { timeout?.cancel(); browser?.stop(); advertisement?.stop() }
}

class TPVBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TPVRoomDiscoveryPlugin())
        bridge?.registerPluginInstance(TPVLiveActivityPlugin())
    }
}
