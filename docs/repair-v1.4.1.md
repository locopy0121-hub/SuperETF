# SuperETF v1.4.1 — LIVE WebSocket 連線狀態修護

## 實機截圖追查
- v1.4.0 在台股交易時段顯示「LIVE 驗證失敗 · REST 備援」，但 REST 價格正常。
- 原始碼將所有未通過 WebSocket 驗證前的 error 視為永久認證失敗，且關閉重試；此為確認的錯誤分類邏輯。不能僅憑此提示判斷富果 API Key 無效。

## 本版修正
- 保留官方 `wss://api.fugle.tw/marketdata/v1.0/stock/streaming`、`auth.data.apikey` 與 `subscribe` 封包。
- 僅收到明確的 invalid authentication credentials 類訊息時才停止自動重連，提示「金鑰遭拒」。
- 暫時的 WebSocket 連線失敗、握手、服務回應與心跳逾時改為指數退避重試；避免誤當金鑰無效。
- 頻道訂閱權限不足與 API Key 拒絕分開；部分頻道被拒時不干擾已獲授權的其他標的；全部無法確認訂閱才顯示 permission-error。
- 股票與 ETF 使用 `trades`，指數使用 `indices`，避免無必要的 aggregates 依賴；REST 保留日開高低、昨收及備援。
- 收到「subscribed」僅顯示訂閱成功待成交；收到非試撮、合法、已確認頻道的即時成交或指數訊息才顯示 LIVE。
- 超過 90 秒沒有 Tick 會顯示等待成交；75 秒無任何 heartbeat / frame 觸發重連。
- 行情首頁增加不洩漏 API Key 的細分診斷和 LIVE／REST 各自的最後更新時間。
- 修訂自動化測試以覆蓋一般 WebSocket 錯誤、確定的金鑰拒絕、部分頻道拒絕、全部訂閱拒絕、LIVE 首筆資料及停滯。

## 仍需實機驗證
- 若富果確實回傳無效金鑰或頻道未授權，此為帳號或方案權限問題，App 不能自行解鎖。
- REST 200 只代表 HTTP 授權與單次價格查詢可用，不代表 WebSocket 串流權限已開放。
- 不應以 GitHub Actions APK 成功宣稱 WebSocket LIVE 已於真實帳號連線成功。
