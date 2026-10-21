# SuperETF v1.4.5 — 修復 Android 安裝失敗與簽章穩定

## 已實證的根因

舊版 GitHub Actions 每次以全新 Ubuntu Runner 執行 `npx cap add android`、`assembleDebug`，沒有保存 `~/.android/debug.keystore`。
以 `keytool -printcert -jarfile` 直接檢查下載的 APK，確認 v1.3.2、v1.3.3、v1.4.2、v1.4.3、v1.4.4 的簽署憑證 SHA-256 **全部不同**。
Android 對同一 packageName `com.locopy.superetf` 的覆蓋安裝必須使用相同簽名；不同簽名造成 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`（可能顯示「應用程式未安裝」）。

## 本次修護

### A. 立即可安裝、且不刪除原有 App 的預覽版

一般 push 即產生 `SuperETF-v1.4.5-preview.apk`，套件名稱 `com.locopy.superetf.preview`（不同於正式 App），圖示名稱「SuperETF 預覽版」。
它可與舊的 `com.locopy.superetf` 並存，避免簽名衝突，且不會覆蓋或刪除舊資料。
**預覽版不會自動讀取舊 App 的本機持股、API Key 或股息**，不得當作已完成資料遷移；Runner 的預覽版 Debug 簽名也不承諾跨版本穩定。

### B. 將來可以持續更新的正式套件

需要固定且私有的 PKCS#12 金鑰，存到 GitHub **Actions Secrets**（不是 Git repo），工作流程只有在四個 Secrets 同時存在時才額外產出 `SuperETF-v1.4.5-signed.apk`：
- `SUPERETF_KEYSTORE_BASE64` — 由私有 `.p12` 內容做 Base64
- `SUPERETF_STORE_PASSWORD`
- `SUPERETF_KEY_ALIAS`
- `SUPERETF_KEY_PASSWORD`

本次已另行建立簽章憑證並存於私有 Library；簽章憑證的公開 SHA-256 為
`E5A3E1C27E39E0E72A55E191882D0F54759A55165737CDA51A6125CC508AFF9F`。
金鑰與密碼**不得提交至任何公開 GitHub 檔案、Issue 或公開聊天記錄**。
設定路徑：GitHub SuperETF → Settings → Secrets and variables → Actions → New repository secret；需具備 repo 管理權限。

Workflow 在 release 前與 release APK 完成後分別檢查憑證的 SHA-256；如不一致便失敗，禁止誤發不同簽章。
另外驗證 packageName、versionCode、Android APK signature 的完整性。
版本 `1.4.5` 的 versionCode 為 `10405`，保證高於 `1.4.4` 的 `10404`。

### C. 對舊版簽章一次性處理

重要：上述新金鑰 **不是** v1.4.4 的舊金鑰。即使設定成功，也**不能直接覆蓋**已安裝的 v1.4.4；Android 的簽署身份不允許任意更換。
舊 Debug Runner 內的私鑰沒有隨 APK 保存；只有簽章公開憑證，無法還原私鑰。

要保留舊本機資料，請先備份再考慮卸載：
1. 若只需測試新功能，安裝 `preview` 與舊版並存；**不用卸載**，原資料仍在舊 App 中。
2. 有 Android Platform Tools 與 USB 偵錯的進階使用者，可於舊版仍安裝時執行 `bash scripts/migrate-debug-data.sh backup ./superetf-private-backup.tar`；確認備份後才處理舊版。
3. GitHub Secrets 設定完成並取得正式簽署版本後，如決定卸載原 App，重新安裝 `signed` APK，再執行 `bash scripts/migrate-debug-data.sh restore ./superetf-private-backup.tar` 嘗試還原。請實機驗證相容性；ADB 備份可能受 Android／裝置設定限制。
4. 備份檔包含本機行情設定與 API Key，請妥善保管，不要放入公開 repo 或上傳到他人帳號。

**禁止**以同一套件名稱但隨機 debug 簽章繼續產出「可覆蓋更新」的 APK，也不要在未備份前直接要求卸載。

## 驗收

CI 必須通過 Node 測試、Gradle build、`aapt dump badging` package/versionCode、`apksigner verify` 簽章核驗，並上傳預覽版 APK。
Github secrets 尚未設定時只會產出 preview，會明確 Warning；不能宣稱正式 release 簽章已經建置。
