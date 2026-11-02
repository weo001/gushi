import UIKit
import Capacitor
import StoreKit
import Security

// 所有遊戲共用的小外掛（複製到 ios/App/App/，並在 MainViewController 註冊）
// 網頁端：Capacitor.nativePromise('Studio', '方法', {...})
//   deviceId      → { id }：存在 iPhone 鑰匙圈的隨機編號，刪掉 App 重裝也不變（邀請好友用來防作弊）
//   requestReview → 請蘋果跳出評分視窗（蘋果自己決定要不要跳，一年最多 3 次）
//   share         → { text, url }：打開 iPhone 分享選單（LINE、訊息、IG…）
//   takeUrl       → { url }：從邀請頁「打開遊戲」帶進來的網址（weo-xxx://invite?c=碼），拿一次就清掉
//
// AppDelegate 的 application(_:open:options:) 裡要加一行：StudioPlugin.lastURL = url.absoluteString
@objc(StudioPlugin)
public class StudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StudioPlugin"
    public let jsName = "Studio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "deviceId", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeUrl", returnType: CAPPluginReturnPromise),
    ]

    // 冷啟動時外掛可能還沒載入，所以由 AppDelegate 先存在這裡
    public static var lastURL: String?

    @objc func takeUrl(_ call: CAPPluginCall) {
        let u = StudioPlugin.lastURL ?? ""
        StudioPlugin.lastURL = nil
        call.resolve(["url": u])
    }

    private let account = "studio.device.id"

    private func readId() -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    private func saveId(_ id: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(id.utf8),
            // 只留在這台手機（換新手機用備份還原也不會帶過去）
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemDelete(q as CFDictionary)
        SecItemAdd(q as CFDictionary, nil)
    }

    @objc func deviceId(_ call: CAPPluginCall) {
        if let id = readId(), id.count >= 32 { call.resolve(["id": id]); return }
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let id = bytes.map { String(format: "%02x", $0) }.joined()
        saveId(id)
        call.resolve(["id": readId() ?? id])
    }

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                SKStoreReviewController.requestReview(in: scene)
                call.resolve(["ok": true])
            } else {
                call.resolve(["ok": false])
            }
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        var items: [Any] = []
        if let t = call.getString("text") { items.append(t) }
        if let u = call.getString("url"), let url = URL(string: u) { items.append(url) }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.resolve(["ok": false]); return }
            let a = UIActivityViewController(activityItems: items, applicationActivities: nil)
            // iPad 一定要指定位置，不然會當掉
            a.popoverPresentationController?.sourceView = vc.view
            a.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            a.completionWithItemsHandler = { _, done, _, _ in call.resolve(["ok": done]) }
            vc.present(a, animated: true)
        }
    }
}
