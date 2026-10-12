# Sync-Us

> 讓伴侶看見彼此的壓力與付出，透過共享泡泡一起規劃生活、減少誤解並共同成長。

Sync-Us 是一個以情侶共同生活為核心的開源 Web App。它不把生活安排做成冷冰冰的 Todo List，而是將待辦事項轉化為有大小、軌道與歸屬的泡泡，讓兩個人更直覺地理解彼此正在承受什麼。

## 核心體驗

- **星域**：用泡泡大小與軌道呈現壓力、急迫程度和任務歸屬。
- **週記**：以日期分列、左右兩欄（我／對方）的雙人週筆記。各自快速記下行程、待辦和筆記，標記「有空／不方便」；兩人都有空時可以邀請見面，對方接受後那天出現一列橫跨兩欄的「♡ 一起見面」。也能匯入 .ics 日曆（對方預設只看到「有行程」）。
- **泡泡**：建立、分配、安排與篩選共同或私人事項。
- **連結**：透過邀請碼配對，累積對方的小手冊與共同足跡。
- **星塵獎勵**：在首頁長按戳破完成的泡泡，將完成感轉化為可累積的星塵，並在商城兌換（從星塵瓶或「我的」進入，兌換紀錄會保存）。
- **隱私邊界**：私人泡泡只有建立者看得到，對方只會知道數量；配對資料由後端驗證成員權限。
- **手機與電腦**：手機用底部導覽、電腦用左側導覽，星域、泡泡清單與手冊都有對應的版面。
- **即時又不怕按錯**：打開只要一個請求；對方的變更幾秒內自動出現；完成、刪除都能馬上「復原」，泡泡也可以編輯。
- **像 App 一樣使用**：可以加到手機主畫面；邀請伴侶時直接分享連結，對方點開就帶入邀請碼。

## 技術架構

| 層級 | 技術 |
| --- | --- |
| Frontend | React 19、Vite、Lucide Icons |
| Backend | Python、FastAPI-compatible service layer、HTTP server |
| Database | SQLite |
| Deployment | Cloudflare Tunnel |
| Testing | Python verification scripts、Vite production build |

## 專案結構

```text
frontend/                 React 前端
  src/components/         依產品功能拆分的 UI 元件
  src/api/                API client
  src/utils/              日期、泡泡排版、照片壓縮與音效工具
sync_us_app/              Python 後端
  database.py             Schema 與資料庫初始化
  services.py             核心商業邏輯與權限驗證
  planner.py              雙人週記（事項、有空狀態、見面邀請、日曆匯入）
  simple_server.py        本機與正式靜態服務入口
  fastapi_app.py          FastAPI 路由介面
tests/                    行為驗證腳本
run_sync_us.py            應用程式啟動入口
```

## 本機啟動

需求：Python 3.10+、Node.js 20.19+ 或 22.12+。

```powershell
git clone https://github.com/Abralive/sync-us.git
cd sync-us\frontend
npm ci
npm run build
cd ..
python run_sync_us.py
```

瀏覽器開啟：<http://127.0.0.1:8051>

第一次啟動會在專案根目錄建立本機 SQLite 資料庫（WAL 模式），並在 `backups/` 每天自動備份、保留 14 份。資料庫、備份、日誌、環境變數、建置產物與 `node_modules` 都不會提交到 Git。

Windows 上想要登入後自動在背景執行，執行一次 `deploy\windows\install_autostart.bat`；網域打不開時執行 `deploy\windows\status.bat` 查看原因。

## 驗證

```powershell
cd frontend
npm run build
cd ..
python -m compileall -q sync_us_app tests
python tests\verify_couple_invites.py
python tests\verify_connection_features.py
python tests\verify_privacy_and_rewards.py
python tests\verify_speed_and_undo.py
python tests\verify_weekly_planner.py
node --test tests\verify_ics_import.mjs tests\verify_planner_dates.mjs
```

## 專案狀態

目前為持續開發中的產品原型，已完成帳號建立、伴侶邀請與配對、共同／私人泡泡、日期排程、長按完成、星塵回饋、對方小手冊、共同足跡與雙人週記等主要流程。

正式商用前仍需完成伺服器端密碼驗證、受管理的 PostgreSQL、物件儲存、監控、備份與完整自動化測試。

## 文件

- [產品企畫](01_Sync-Us_Proposal.md)
- [UX 改善計畫](05_Sync-Us_UX_Improvement_Plan.md)
- [伴侶連結設計](12_Sync-Us_Couple_Link_Phase1.md)
- [新電腦部署手冊](13_Sync-Us_New_PC_Deployment.md)
- [RWD 改版與問題修復報告](15_Sync-Us_RWD_Bugfix_Report.md)
- [速度、使用體驗與架設優化報告](16_Sync-Us_Speed_UX_Hosting_Report.md)
- [雙人週記開發報告](17_Sync-Us_Weekly_Notes_Report.md)

## License

本專案採用 [MIT License](LICENSE)。
