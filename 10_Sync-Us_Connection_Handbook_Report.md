# Sync-Us 連結頁共同手冊改版紀錄

日期：2026-08-07

## 本次目標

將「連結」從聊天、日記或關係動態牆，重新定位為會隨著兩人一起生活慢慢長大的共同手冊。

三個主功能重新切清楚：

- 星域：看見彼此目前正在承受與處理的事情。
- 泡泡：建立、分配、安排並完成共同事務。
- 連結：累積彼此的重要資訊，以及共同完成過的事情。

## 已完成

- 手機版「連結」頁改成共同手冊架構。
- 新增「問問 Sync」結構化查詢，只讀取已確認手冊資料。
- 新增「對方的小手冊」分類資料：基本資訊、飲食與健康、喜好、相處提醒、規劃偏好、其他備忘。
- 新增「共同足跡」時間軸。
- 共享泡泡完成後會自動建立共同足跡。
- 完成泡泡後可補一張照片與 80 字內紀錄，也可直接完成。
- 私人泡泡不會進入共同足跡。
- 後端新增 couple 成員權限驗證，非配對使用者不能讀取資料。
- 完成請求改成 idempotent，同一顆泡泡重複完成不會重複產生足跡。
- 底部導覽文字修正為：星域、連結、泡泡、商城、我的。

## 資料庫變更

新增 `partner_manual_entries`：

- `couple_id`
- `subject_user_id`
- `category`
- `label`
- `value`
- `source_type`
- `source_label`
- `status`
- `created_by_id`
- `updated_by_id`
- `created_at`
- `updated_at`

新增 `shared_footprints`：

- `couple_id`
- `bubble_id`
- `task_title`
- `completed_at`
- `participants`
- `photo_data_url`
- `note`
- `created_by_id`
- `updated_by_id`
- `created_at`
- `updated_at`
- `original_task_json`

`shared_footprints.bubble_id` 有唯一限制，避免重複足跡。

## 權限規則

- 所有共同手冊與共同足跡 API 都會檢查目前 `user_id` 是否屬於該 `couple_id`。
- 手冊對象只能是同一組 couple 裡的兩位使用者。
- AI 查詢只讀 `status = confirmed` 的手冊資料。
- AI 查不到資料時回覆「目前沒有記錄」，不推論健康、過敏或喜好。
- 私人泡泡完成後不寫入共同足跡。

## 6 大測試

已通過 `python tests/verify_connection_features.py`：

1. 共享泡泡完成後會自動建立一筆共同足跡。
2. 同一顆泡泡重複完成不會產生重複足跡。
3. 私人泡泡完成後不會進入共同足跡。
4. 共同足跡可補文字與照片資料。
5. 手冊資料需確認後才會被問問 Sync 查詢到，且答案包含來源。
6. 非配對使用者無法讀取共同足跡。

## 視覺與互動驗證

- `npm.cmd run build` 通過。
- Playwright 已打開 `http://127.0.0.1:8051/?review=1&v=connection-handbook-4`。
- 已截手機版 `390x844` 連結頁、問問 Sync、共同足跡。
- 已截桌面版 `1280x900` 連結頁、問問 Sync、共同足跡。
- Playwright 檢查手機版沒有水平溢出。

截圖位置：

- `artifacts/connection-handbook/mobile-query-final.png`
- `artifacts/connection-handbook/mobile-timeline-final.png`
- `artifacts/connection-handbook/desktop-landing.png`
- `artifacts/connection-handbook/desktop-query.png`
- `artifacts/connection-handbook/desktop-timeline.png`

## 後續仍建議改善

- 固定底部導覽在 full-page 截圖中會壓在第一個 viewport 位置，實際可滑動，但後續可以針對手冊頁做更細的 safe-area spacing。
- 目前照片先以 data URL 存 SQLite，適合本機原型；正式上線應改成物件儲存或後端檔案儲存。
- SQLite connection 目前大量使用 `with sqlite3.Connection`，會 commit/rollback 但不會立即 close；後續可整理連線生命週期。
- 目前沒有真正登入權杖，公開網域前仍需 Cloudflare Access 或正式 auth。
