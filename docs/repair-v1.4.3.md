# SuperETF v1.4.3 — LIVE 連線額度修護

## 問題與證據
- Android v1.4.2 實測富果 WebSocket 收到 `Maximum number of connections reached`；REST 日內 API 正常不代表 WebSocket 可建立。
- 富果最新官方行情方案：基本用戶 1 條 WebSocket / 5 訂閱，開發者與進階 2 條 WebSocket。不能藉由 REST 輪詢宣稱 LIVE。
- 使用相同帳號的 TF Asset、另一個 App 或其他裝置可能占用伺服器允許的串流連線。
- 參照 ETF-Asset-V1.0 的 `src/market/FugleWebSocketProvider.ts`：單一 WebSocket 多標的訂閱、provider 生命週期與冷卻回路。
- 專案 AGENTS 檔僅於 TF Asset 來源專案確認；依其「最小必要變更、具體回歸測試、驗證後交付」執行。

## 修護
- WebSocket 專用連線額度錯誤（含英文回覆與 Close Reason）不再落入普通 1.5–30 秒重試；變為 `capacity-wait`，首度冷卻 300 秒，反覆超額可延至 900 秒。
- 顯示下一次受控重試時間、連線次數、最後伺服器錯誤，並提示關閉其他使用相同 API Key 的 App/裝置。
- Android WebView 頁面切到背景或關閉時主動結束 WebSocket，停止重試；切回前景且位於交易時段，再使用共用的單一連線訂閱。設定重建有舊 socket 時先釋放、延遲 2.5 秒後連線，以減少新舊 session 同時佔位。
- 盤中 LIVE 訂閱以既有持股優先，其次加權指數及剩餘觀察標的；不變更股數、成本、交易資料。
- 只有 WebSocket 已認證、已訂閱且實際收到逐筆事件才顯示 LIVE。各證券卡片標記 LIVE 需要個別最新 tick 不超過 90 秒。
- 保留與 TF Asset 不同程序的實際伺服器連線限制。SuperETF **無法關閉其他 App 的 WebSocket**，無法規避富果方案額度。

## 驗收
- Node 模擬測試驗證連線額度事件、禁止高速重連、切背景釋放、單一連線復原、前台訂閱與真實逐筆。
- GitHub Actions npm tests、Capacitor / Android Gradle Build 與上傳版本化 APK Artifact。
- 尚需持有有效且有空額的 API Key 及 Android 實機，確認富果真正串流資料已進入 SuperETF；CI 不會宣稱此項已實測。
