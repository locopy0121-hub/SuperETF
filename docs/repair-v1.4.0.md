# SuperETF v1.4.0 — 台股盤中富果 LIVE 訂閱

## 目標
App 在台北時間週一至週五 09:00–13:30 使用富果 Market Data **WebSocket** 取得逐筆成交／聚合行情／加權指數，而非依靠每 30 秒 REST 輪詢。實際休市日仍需交易所行事曆交叉驗證。

## 官方協議
- WSS: `wss://api.fugle.tw/marketdata/v1.0/stock/streaming`
- onopen: `{"event":"auth","data":{"apikey":"<API_KEY>"}}`
- authenticated: `{"event":"subscribe","data":{"channel":"trades","symbol":"2330"}}`
- 股票與 ETF：`trades` + `aggregates`，指數：`indices`。
- `data` 事件：成交價 `data.price`、聚合 `lastTrade.price`、指數 `data.index`。
- 僅接收正數、代號合法且已訂閱頻道；排除 `isTrial=true` 試撮，不以試撮價冒充正式成交。
- 僅在收到有效 `subscribed` ACK 後顯示 LIVE，只有連線中／驗證中時不得呈現 LIVE。
- Server heartbeat 每 30 秒；超過 75 秒沒有任何訊息判斷斷線，退避重試（1.5s～30s）。

## 與既有資料模型整合
- 每次 LIVE Tick 立即寫入對應 Quote 的 price/source/timestamp，透過 requestAnimationFrame 將當前頁面行情、損益與圖表同步刷新。
- REST 在啟動時抓取昨收、開高低基準；LIVE 健康時 REST 校正間隔放寬為 180 秒，斷線時 30 秒輪詢備援。REST 或 Yahoo 的落後回覆不得覆蓋較新的 LIVE 值。
- 13:30 一般交易時段結束後停止串流並補最後一次 REST 快照；非盤中時間保留最後有效行情，不使用模擬數值。
- 新增持股時即刻訂閱新標的；設定更換 API Key、代號映射會重建連線。
- App 恢復可見、網路重新連線後重建失效 WebSocket；網路中斷取消 LIVE 狀態。
- 過去的 `^TWSE -> IR0001` 映射殘留導致抓到報酬指數；統一 `^TWSE -> IX0001`（發行量加權股價指數）。

## 測試與安全
- 新增 WebSocket 模擬測試：交易時段、驗證前不得訂閱、ACK 後才標 LIVE、trades/aggregates/indices、亂序資料、動態加訂、重連、heartbeat、授權拒絕、無 API Key。
- 原有六頁 UI、證券名稱、富果 API 回歸測試必須全部成功，才允許 Actions 生成 Artifact。
- API Key 僅在 TLS WebSocket 建立後透過官方認證訊息送出，不放入 URL 或 Log。
- 盤中 LIVE 取決於富果帳號訂閱權限與裝置網路；此版本不宣稱實機驗證已通過，也不保證 App 關閉時持續背景推播。
