import UIKit
import Capacitor

// 讓 Capacitor 載入我們自己的外掛（Main.storyboard 指向這個類別）
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(StudioPlugin())
    }
}
