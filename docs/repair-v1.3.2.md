# SuperETF v1.3.2 修護

- 依據最後成功的 v1.1.2 APK 引擎恢復完整六頁 UI 事件與卡片渲染，保留現行 HTML 及 localStorage keys。
- 恢復 @capacitor/android/core/cli 6.x 依賴與 GitHub Actions 原本成功的 JS→APK 建置流程。
- 富果 TAIEX 指數使用 IX0001，TRI 保留 IR0001；Yahoo 指數使用 ^TWII；個別報價失敗時逐檔備援。
- 移除模擬 random-walk 損益。未取得真實報價的持股不列入已確認總損益。
- 自動初始同步及市場時段定期同步，09:00–13:30 Asia/Taipei，假期不推斷開市。
- 新增 UI 契約、富果指數代號、來源測試，修正主要表格資料 HTML escaping。
- 已知待完成：WebSocket LIVE 訂閱、固定版本簽章、完整交易流水帳、加密 API Key、官方休市表、完整端對端測試。
