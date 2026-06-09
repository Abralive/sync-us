**開發提案書**  
*以下全文採用繁體中文撰寫，並依所定義的結構完整呈現。*  

---

## 1. Vision & Core Solution  
**願景**：建立一款專為情侶設計的「智慧日程防擾」APP，讓雙方在日常排程中能即時掌握彼此的重要程度，減少因突發性打擾而產生的衝突與誤解。  

**核心解決方案**：  
- **一鍵輸入**：透過聲音、文字或簡易表情即可快速新增任務，降低操作門檻。  
- **視覺化優先權權重卡**（Visual Priority Weight Card）：任務以「卡片」形式呈現，卡片大小與顏色即刻顯示優先權等級，避免傳統文字列表的平面呈現。  
- **互動式排程**：於「卡片」上拖曳、長按即可調整時間、優先級，實時同步至伴侶端，形成「阻擋低優先權任務干擾高優先權任務」的機制。  

---

## 2. System Architecture  

| 層級 | 技術選擇 | 主要功能 |
|------|----------|----------|
| **後端** | **FastAPI**（Python） | • 提供 RESTful API  <br>• 處理任務創建、更新、排程、權重計算 <br>• 使用SQLAlchemy ORM 與資料庫交互 <br>• 具備非同步處理與自動文件產出（OpenAPI） |
| **前端** | **React Native**（TypeScript） | • 跨平台（iOS / Android） <br>• 以「卡片」為基礎的 UI 組件 <br>• 本地即時狀態管理（Redux Toolkit / React Context） <br>• 低功耗的背景同步機制 |
| **資料庫** | **PostgreSQL** | • 結構化儲存任務、卡片、排程、使用者資料 <br>• 支援 JSONB 欄位存放彈性的卡片屬性 |
| **託管與 DevOps** | Docker + Kubernetes (或 Serverless) | • 容器化部署，確保環境一致性 <br>• 自動擴展與彈性調整 |

**架構流程**：  
1. 前端使用者透過一鍵輸入產生任務 → 發送 API請求至 FastAPI。  
2. FastAPI 解析任務資料，依「優先權權重」演算法計算權重分數。  
3. 計算結果返回前端，前端即時生成「視覺化卡片」並同步至資料庫。  
4. 當有新任務排程或優先權變更時，FastAPI 觸發「反擾動作」檢查，確保低權重任務不會調動或覆蓋高權重任務的時間區塊。  

---

## 3. UI/UX Core Philosophy  

1. **視覺優先權（Visual Priority Weighting）**  
   - 每張卡片的「寬度」與「圓角」表現優先級，權重高者卡片更寬、顏色更醒目（紅/橘 > 黃/綠）。  
   - 卡片上方顯示時間軸標記，左側即時顯示「可干擾」程度，讓使用者一眼判斷。  

2. **「不」的傳統列表**  
   - 完全捨棄「清單」式的文字列表，改用「卡片」堆疊、縱向/橫向捲動。  
   - 切換「日曆」或「時間軸」視圖，讓任務自然呈現在時間格子裡，強化「時間即優先」的概念。  

3. **最小化摩擦**  
   - **一鍵錄音 / 手勢輸入**：語音轉文字即時產生卡片，或長按產生空白卡片快速填入。  
   - **即時同步**：伴侶端在任務被加入或變更的瞬間即獲得推播與卡片縮放動畫，減少資訊滯後。  

4. **互動保護機制**  
   - 當低權重卡片嘗試覆蓋高權重卡片的時間區塊時，卡片自動彈出「阻擋」提示，需伴侶確認後才能挪動。  
   - 透過「預約」功能，系統會自動在高權重卡片周圍建立「保護牆」，禁止低權度任務填入。  

---

## 4. Database Schema  

| 表格 | 欄位說明 | 主鍵 / 外鍵 |
|------|----------|------------|
| **users** | id、username、email、hashed_pw、created_at | PK: id |
| **couples** | id、partner_a_id (FK→users.id)、partner_b_id (FK→users.id)、status、created_at | PK: id |
| **tasks** | id、title、description、created_by_id (FK→users.id)、due_date、duration_minutes、base_priority | PK: id |
| **priority_weights** | id、task_id (FK→tasks.id)、weight_score、weight_type (enum: time, effort, importance)、updated_at | PK: id |
| **schedules** | id、task_id (FK→tasks.id)、couple_id (FK→couples.id)、slot_start、slot_end、is_blocked | PK: id |
| **interruptions** | id、task_id (FK→tasks.id)、couple_id (FK→couples.id)、interrupted_at、reason | PK: id |
| **settings** | id、couple_id (FK→couples.id)、voice_input_enabled、max_concurrent_tasks | PK: id |

**重要欄位說明**：  
- `priority_weights.weight_score` 為「權重分數」，由後端根據任務屬性（如預估時間、重要性評分）自動計算，數值越高代表越優先。  
- `schedules.is_blocked` 用於標記是否已被高優先卡片「保護」而無法被低優先任務調整。  
- `interruptions` 記錄每一次被阻擋的干擾事件，供後續分析與 UI 提示使用。  

---

## 5. API & Anti-Interruption Logic  

### 5.1 主要 API 端點  

| 方法 | 端點 | 描述 | 主要回應 |
|------|------|------|----------|
| POST | `/api/v1/couples/{couple_id}/tasks` | 一鍵新增任務（支援語音、文字、手勢） | 任務 ID、產生的 **Priority Card**（含權重、樣式指令） |
| GET | `/api/v1/couples/{couple_id}/tasks` | 取得該情侶所有任務的卡片資訊 | 任務列表（已排序）+ 卡片樣式參數 |
| PATCH | `/api/v1/tasks/{task_id}` | 編輯任務（時間、說明、優先級） | 更新後的 **Priority Card** |
| POST | `/api/v1/tasks/{task_id}/schedule` | 手動排程（設定具體時段） | 排程記錄、自動觸發 **Anti‑Interruption** 檢查 |
| POST | `/api/v1/tasks/{task_id}/interrupt` | 手動申請被干擾（伴侶端） | 記錄干擾事件、更新 `interruptions` 表 |

### 5.2 Anti‑Interruption 邏輯  

1. **權重計算（FastAPI）**  
   - 於 `POST /tasks` 與 `PATCH /tasks` 時，呼用 `_calc_priority_weight(task)` 方法。  
   - 內部規則：  
     - **時間長度**（分鐘）× 0.3  
     - **重要性評分**（1‑5）× 0.5  
     - **預估努力**（低/中/高）× 0.2  
   - 總分最高者即設為 `weight_score`，存入 `priority_weights`。  

2. **排程衝突檢查**  
   - 當新增或修改排程 (`/schedule`) 時，進入 `_check_blocking_schedule(couple_id, new_slot, task_id)`。  
   - 步驟：  
     a. 取出同時間段已有的 **已保護卡片**（`is_blocked = true`）的 `task_id` 與 `priority_score`。  
     b. 若 `new_task.weight_score` < 已保護卡片 `priority_score`，**拒絕**設定，回傳錯誤 `409 Conflict` 並附上阻擋說明。  
     c. 若不衝突，則更新 `schedules`、標記 `is_blocked`（若新任務為高權重）或保持原狀態。  

3. **即時阻擋提醒**  
   - 前端在收到 `200 OK` 之後，根據 `schedules.is_blocked` 判斷卡片是否被鎖定，若被鎖定則顯示半透明遮罩與「此時段已受保護」提示。  
   - 若低權重任務嘗試拖曳至已被保護的時段，前端即時彈出「阻擋」對話框，要求伴侶確認解除保護後才可放置。  

4. **干擾事件紀錄**  
   - 當前端成功「強制」調動低權重卡片至高權重卡片的時段時，會呼叫 `/tasks/{task_id}/interrupt`，FastAPI 產生 `interruptions` 記錄，並推播提醒給被干擾的伴侶。  

### 5.3 安全性與可靠性  

- **JWT 連署**：所有 API 必須攜帶有效 JWT（由 FastAPI 簽發），確保只有配對雙方才能存取彼此的日程。  
- **速率限制**：對寫入密集的任務與排程請求設限（如 30  req/min），防止濫用。  
- **資料一致性**：使用 PostgreSQL 事務（`BEGIN … COMMIT`）確保「任務 → 權重 → 排程」三步驟要麼全成功，要麼全回滾。  

---

### 結論  

本提案以 **FastAPI** 做為後端核心、**React Native** 作為視覺化卡片式 UI 的前端框架，搭配 **PostgreSQL** 以結構化、可擴充的資料模型，實現「一鍵輸入」與「視覺化優先權權重卡」的全新夫妻日程防擾體驗。透過嚴謹的 Anti‑Interruption 演算法與即時同步機制，確保低優先權任務永遠不會干擾高優先權工作或約會時間，從根本上減少伴侶間的誤會與衝突。  

---  

*Prepared by: [Your Name], Tech Lead & Product Manager*  
*Date: 2025‑11‑03*