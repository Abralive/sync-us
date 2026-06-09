**1. 檔案總覽**  
在本次交接中，共產生了以下三個檔案：

- **01_Sync-Us_Proposal.md** – 專案提案文件，包含需求說明、功能列表與技術挑戰的概覽。  
- **02_backend_main.py** – FastAPI 後端程式，負責 JWT 驗證、SQLAlchemy ORM（非同步 PostgreSQL）模型、任務的 CRUD 作業、權重計算、排程保護與中斷記錄的實作。  
- **03_frontend_App.js** – React Native 前端程式，提供使用者界面（卡片式排程、拖曳排程、資訊卡片顯示），透過 API 呼叫上述後端服務，實作使用者登入、任務列表、排程與中斷交互。  

---

**2. 架構關係**  

- **前端 ↔ 後端通訊**：  
  `03_frontend_App.js` 中的所有 API 呼叫（`fetchTasks`、`scheduleTask`、`interruptTask`）均使用標準的 HTTP POST/PUT 要求，請求與回應格式均遵循 FastAPI 所定義的 JSON 結構。  
  - 前端在使用者選取、長按或拖曳任務卡片時，會產生對應的日期時間戳或位移訊號，傳至後端的 `/api/v1/tasks/{task_id}/schedule` 或 `/api/v1/tasks/{task_id}/interrupt` 端點。  
  - 後端在接收排程請求後，會驗證權限、計算任務權重 (`_calc_priority_weight`)、比對衝突排程（`_check_and_set_schedule`）並回傳成功或錯誤訊息；中斷請求則在後端記錄 `Interruption` 記錄，若有需要可自行擴充推播提醒功能。  

- **資料流向**：  
  1. **使用者產生任務**：前端呼叫 `create_task`（在程式碼未直接呈現但已在 `02_backend_main.py` 內實作），後端根據使用者所屬情侶、任務參數建立 `Task`、`PriorityWeight` 兩筆資料並計算 `weight_score`，回傳給前端供展示。  
  2. **任務排程**：前端傳入欲排程的區間 (`slot_start`, `slot_end`)，後端檢查是否已有更高優先級的受保護排程；若有衝突且新任務權重低於已保護的排程，則回傳 409 Conflict；若新任務權重較高或相等，則將衝突排程設為 `is_blocked=True`，最後建立新排程並回應成功。  
  3. **任務中斷**：前端在佯模中斷情境（伴侶端手動申請）時，呼叫 `interrupt_task`，後端在 `interrupt_task` 處理器中建立 `Interruption` 記錄，完成中斷追蹤。  
  4. **任務列表與卡片顯示**：前端透過 `fetchTasks` 取得所有任務資料，依序渲染 `TaskCard`。卡片的顏色與寬度根據 `weight_score` 進行縮放與顏色映射（`getCardStyle`），此屬前端 UI 層的呈現邏輯，與後端的權重計算層分離。  

- **整體架構**：前端負責使用者交互與視覺化狀態管理，後端負責業務邏輯、資料持久化與安全驗證；兩者透過 RESTful API 通訊，保持弱耦合，便於未來前後端獨立擴充。  

---

**3. 接手指南**  

- **第一步檢查**：立即打開 **01_Sync-Us_Proposal.md**，確認需求範圍、技術限制與交付物清單，確保未來開發方向與文件一致。  
- **第二步後端檢查**：  
  1. 以 **02_backend_main.py** 為主軸，先檢視 `FastAPI` 設定、資料庫連線字串 (`DATABASE_URL`)、以及 `get_current_user` 的簡易實作（只驗證 token 是否為 `"valid_token"`）。  
  2. 重點關注以下函式與類別的實作細節：  
     - `TaskCreate`, `TaskUpdate`, `TaskResponse`：確認輸入驗證與回應結構。  
     - `_calc_priority_weight`：權重計算公式與「時間 × 0.3、重要性 × 0.5、努力因子 × 0.2」是否符合需求。  
     - `_check_and_set_schedule`：排程衝突保護與高權重任務自動阻擋的邏輯，確保未來若有 UI 端不同步時不會出現衝突。  
  3. 確認 `record_interruption`、`schedule_task` 等端點的回應格式與錯誤處理是否完整。  

- **第三步前端檢查**：  
  1. 打開 **03_frontend_App.js**，檢查 `API_BASE` 是否正確指向本機或實際部署的後端服務位址。  
  2. 確認 `TaskCard` 元件的 UI 設計（顏色、寬度）是否正確讀取 `weight_score`；若需要調整 UI 端顯示閾值，可修改 `WEIGHT_MAX_DISPLAY` 常數。  
  3. 驗證所有 API 呼叫（`fetchTasks`, `scheduleTask`, `interruptTask`）的請求與回應是否對應後端的實作，尤其是權重計算與排程保護的回應訊息。  

- **第四步測試流程**：  
  1. 啟動後端服務 (`uvicorn sync_us_main:app --reload`)，確保資料庫連線正常。  
  2. 啟動前端開發環境（`expo start` 或 `react-native run-ios/Android`），測試任務建立、列表顯示、排程衝突與中斷功能。  
  3. 若發現任何 401、403、404 或 409 的錯誤，先對照後端對應的驗證與衝突檢查邏輯，快速定位問題根源。  

- **第五步維護建議**：  
  - **安全**：在正式部署時，將 `get_current_user` 換成真正的 JWT 解碼與簽名驗證，並使用環境變數保護資料庫憑證。  
  - **擴充**：若需加入更多权重類型（如「金錢」「風險」），可在 `_calc_priority_weight` 內部加入額外分支或改為策略模式。  
  - **測試**：建議加入單元測試（如 `pytest` + `httpx`) 針對 `Task` 權重計算與排程保護的關鍵邏輯。  

以上即為整個交接的完整說明，請依序檢查文件與程式碼，確保在接手後能夠快速落實與維護此專案。祝開發順利！