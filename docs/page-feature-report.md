# SuperETF 頁面功能與建置規範報告書

## 1. 專案定位

SuperETF 是個人開發的台股資產管理 App，核心任務是以行動裝置管理 ETF、個股與加權指數的即時行情、持倉損益、庫存交易、股息記錄與市場分析。專案採用 Capacitor 將網頁端資源包裝為 Android APK，主行情來源為富果 API，Yahoo Finance 與離線模擬資料作為備援與兜底。

## 2. 目前版本與建置原則

- 目標分支：`main`
- 目前版本：`v1.3.1`
- 版本號原則：依功能新增或 Bug 修復手動遞增，例如 `1.3.1`、`1.3.2`；排程建置不無條件自動遞增版本號。
- 建置平台：GitHub Actions 是唯一編譯、測試、APK 產出平台。
- 建置順序：`npm install` → `npm run build` → `npm test` → Capacitor 產出 Android debug APK。
- 排程：每 30 分鐘自動執行一次 `build-apk` workflow；`push` 與 `workflow_dispatch` 觸發仍然保留。
- 產物：`SuperETF-v<version>-debug.apk`，並以下載 artifact 保存。

## 3. 頁面功能總覽

SuperETF 目前以單頁 App 提供 6 個主要頁面 tab。以下功能以 `index.html` 與 `src/app.ts` 為基準整理。

### 3.1 即時行情

- 顯示 `SEED_QUOTES` 內建代號，涵蓋加權指數、ETF 與個股。
- 依類型以 filter chips 分組：全部、指數、ETF、個股。
- 顯示即時價格、漲跌幅、開盤、最高、最低、昨收、成交量或來源標籤。
- 行情來源優先順序：
  1. 富果 API（啟用且有效 API Key 時）。
  2. Yahoo Finance（富果不可用或 HTTP 200 但無價格時）。
  3. 離線模擬資料（網路失敗或前兩類皆無可用價格時兜底）。
- 每 2 秒執行一次 tick；當來源為 `mock` 時，模擬資料使用 random walk 更新。
- 盤前富果 HTTP 200 但無 `lastPrice` 時，依 `referencePrice`、`previousClose`、`lastTrial` 區分參考價、昨收價、試撮價，不將 HTTP 200 誤判為失敗。

### 3.2 損益牆

- 依 `holdings` 持倉計算目前總市值、總成本、總損益、總損益率。
- 依即時行情更新每一項持倉的現價、損益金額與損益率。
- 損益排序與顏色標籤：獲利綠色、虧損紅色、平盤灰色。
- 與「即時行情」共用 `quotes` 與 `quoteMap`，確保價格來源一致。

### 3.3 庫存

- 列出目前持倉代號、名稱、股數、平均成本、現價、損益、占比。
- 支持新增持倉：輸入代號、名稱、股數、平均成本後保存至 `localStorage`。
- 支持刪除既有持倉，並同步更新總市值與占比。
- 列出交易紀錄（`transactions`），包含買入、賣出、代號、股數、價格與日期。
- 交易紀錄與持倉皆以 `localStorage` 持久化，跨 session 保留。

### 3.4 股息

- 顯示年度股息總計、平均股息率、最近股息記錄。
- 支持新增股息：代號、名稱、股數、每股股息、除權日。
- 股息紀錄依日期排序並保存至 `localStorage`。
- 與持倉代號不強綁定，也可記錄未在「庫存」中的過去持股。

### 3.5 市場分析

- 顯示簡易指標卡片：加權指數現值、日內漲跌幅、日內波動區間、0050 占比等。
- 以 Canvas 繪製加權指數日內走勢圖。
- 走勢圖使用 `Quote._hist` 儲存歷史價格，並以 active tab 每 2 秒重繪。
- 提供簡短分析文案，描述盤前、盤中、收盤後與模擬狀態。

### 3.6 設置

- 管理富果 API 設定：啟用開關、API Endpoint、API Key、代號對應 JSON。
- 保存設定會立即寫入 `localStorage`，並觸發一次 `MarketData.sync()` 驗證。
- 「測試連線」使用未保存的輸入值，避免誤判舊設定。
- 顯示資料來源優先順序：富果 API、Yahoo Finance、離線模擬。
- 顯示版本與「關於」資訊。

## 4. 建置與測試基準

### 4.1 原始碼架構

- `src/app.ts`：所有 UI 邏輯、狀態管理、行情來源優先序、tab 渲染與事件綁定。
- `src/fugle-api.ts`：富果 Market Data v1.0 的共用工具，負責 URL 正常化、代號驗證、報價解析、錯誤訊息。
- `tests/fugle-api.test.mjs`：針對 `dist/fugle-api.js` 的 Node 原生測試，覆蓋標準路由、舊 URL 遷移、Host 安全限制、空報價、盤前參考價、試撮價、HTTP 錯誤分類。
- `index.html` 只引用 `dist/app.js`，不再參考根目錄 `.js`。
- `.gitignore` 排除 `node_modules/`、`dist/`、`www/`、`android/` 等建置產物。

### 4.2 GitHub Actions 判定標準

一次 CI 成功應同時滿足：

1. TypeScript 編譯通過，產出 `dist/app.js` 與 `dist/fugle-api.js`。
2. `npm test` 通過，確認富果 API 核心邏輯無 regression。
3. Capacitor 成功同步 `www/` 到 Android 工程。
4. `gradlew assembleDebug` 成功。
5. APK 檔被正確命名為 `SuperETF-v<version>-debug.apk` 且大小非 0。
6. artifact 上傳成功。

## 5. 待補強項目

| 項目 | 目前狀態 | 建議動作 | 版本影響 |
| --- | --- | --- | --- |
| UI 顯示版本號 | `index.html` 與「關於」固定寫 `v1.3.0`，但 `package.json` 已為 `1.3.1` | 以 `src/app.ts` 的 `VERSION` 為單一來源，於初始化時寫回 DOM | `1.3.1` |
| 排程每 30 分鐘無條件產出不同檔名 | 已取消自動 patch 遞增 | 排程保持「重新驗證目前版本」，不動版本號 | 無 |
| 頁面功能自動化測試 | 目前僅有富果 API 核心測試 | 可再補 UI smoke test；本輪不擴大範圍 | 視功能改動 |

## 6. 本輪任務

- 以「依 A 方案版本號原則」與「GitHub 單一平台建置」為前提，輸出此報告書。
- 修正 UI 版本顯示與 `package.json` 不一致的問題，使 UI 顯示 `1.3.1`。
- 不增加自動版本遞增邏輯，避免版號空轉。
- 不改變排程頻率、不改變 APK 產物路徑、不引入本機建置步驟。
