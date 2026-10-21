# SuperETF v1.4.2 — LIVE WebSocket 隔離修護與診斷

## 已確認原因與修護方向
- 原先程式於任何富果 WebSocket `event:error` 時直接重建整條連線；即使只是一檔股票／ETF 無效，也會導致所有 LIVE 訂閱中斷。
- 原始示例的 `00859` 是未核對代號，沒有有效行情卻嘗試訂閱。已移除錯誤示例。實際存在的 `00859B` 為另一檔不同的 ETF，不會自動替換使用者持股。
- 富果官方 WebSocket URL 與 `auth`、`authenticated`、`subscribe`、`subscribed` 協議保持不變。

## 修護
- 認證成功後改成逐檔訂閱，每檔等待 7 秒 ACK，成功才訂閱下一檔。
- 單檔訂閱收到 `event:error` 或超時時記錄並隔離，不斷開已成功訂閱的 WebSocket。
- 所有標的均失敗時顯示「訂閱失敗」而非假裝 LIVE，避免無限制重連；可由設定頁手動重新測試。
- 保留經過敏感資料遮蔽的伺服器錯誤內容、訂閱標的、關閉代碼、連線次數，供 Android 實機診斷；API Key 不得出現在畫面與日誌。
- 移除 UI 範例錯誤代號 `00859`，不改動既有持股、現金、股息與儲存設定。
- REST 仍作為 LIVE 失效時的有效報價備援。收到實際逐筆且串流有效才能顯示 LIVE。

## 驗收條件
- GitHub Actions 的模擬測試必須包含：單檔無效而其他行情仍 LIVE、金鑰遮蔽、Close Code、逐檔訂閱確認、重連及超時等。
- Android Gradle 必須成功且 Artifact 檔名含版本號。
- 無法透過 CI 驗證使用者 Android 裝置到富果 WebSocket 的實際連線或帳號權限；如仍失敗，請在設定頁的 LIVE WebSocket 診斷查看「最後伺服器錯誤」與「關閉碼」，據此追查網路、伺服器或帳戶限制。
