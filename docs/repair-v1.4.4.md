# SuperETF v1.4.4 — 官方收盤核對與證券詳細資料

## 需求
- 台灣上市股票與 ETF 收盤後優先以 TWSE 官方交易資訊為準。
- 行情牆卡片點擊即可查看完整的已取得證券資料（行情、開高低收、成交量／值／筆數、持股、交易、股息、財務指標）。
- 未公布的欄位不虛構，所有 EOD 資料須附正式交易日期與來源。

## 資料來源與防錯規範
- `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`：上市股票日成交資訊，Date、Code、Name、OpeningPrice、HighestPrice、LowestPrice、ClosingPrice、Change、TradeVolume、TradeValue、Transaction。
- `https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX`：加權股價指數正式收盤，只接受「發行量加權股價指數」，不混用報酬指數。
- `https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule`：休市核對。
- `https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL`、上市公司基本資料與基金彙總資料，僅在打開明細時視需要取用。
- 以臺灣時區對照交易日期；週一至週五 13:45 後，TWSE 仍回傳昨天時**不得覆蓋今日的富果行情**。週末／公告休市日可沿用最近交易日（不超過 10 天）之官方收盤資料。
- 僅在正式日期核對成功後設資料來源為 TWSE；官方尚未公布時繼續顯示最後有效富果值並標示待核對。
- 一旦有正式 TWSE 收盤數值，同日非盤中之 REST/Yahoo 回應不得再覆蓋。
- TWSE 官方資料若缺少特定 ETF 或上櫃證券，明示未取得，不用猜測。上櫃標的不是 TWSE 上市資料，未來應加入 TPEx 官方收盤端點。

## 介面
- 行情卡片採語意化 button 與鍵盤可觸發的原生 dialog。
- 彙整本檔持股、交易、股息與 TWSE 基本資料，顯示資料來源及交易日。
- 使用 textContent DOM API 呈現公開及使用者欄位，不將輸入文字直接寫入 HTML 字串。
- 不變更 App 既有持倉、股息、交易與 API Key 的 localStorage 欄位。
- 保留盤中富果 LIVE WebSocket 與連線額度保護策略。

## 檢查
- 模擬 ROC 日期、過期資料防覆蓋、ETF 英數證券代號、官方指數及資料欄位空值。
- UI 合約與 Android www 資產納入 twse-close.js/security-details.js。
- CI 全數通過與 Gradle APK Artifact 成功上傳才算建置完成。

## 限制
- 若 Android WebView 無法直接存取 TWSE 公開 OpenAPI，顯示取得失敗，不冒充官方收盤。
- 收盤後 TWSE 釋出可能延遲，不可用新資料筆數或請求時間代替正式交易日期。
- TWSE 官方基本資料不是所有 ETF、上櫃股票都涵蓋；未提供者顯示 unavailable。
