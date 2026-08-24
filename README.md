# Sync-Us

> 讓伴侶看見彼此的壓力與付出，透過共享泡泡一起規劃生活、減少誤解並共同成長。

Sync-Us 是一個以情侶共同生活為核心的開源 Web App。它不把生活安排做成冷冰冰的 Todo List，而是將待辦事項轉化為有大小、軌道與歸屬的泡泡，讓兩個人更直覺地理解彼此正在承受什麼。

## 核心體驗

- **星域**：用泡泡大小與軌道呈現壓力、急迫程度和任務歸屬。
- **泡泡**：建立、分配、安排與篩選共同或私人事項。
- **連結**：透過邀請碼配對，累積對方的小手冊與共同足跡。
- **星塵獎勵**：在首頁長按戳破完成的泡泡，將完成感轉化為可累積的星塵。
- **隱私邊界**：私人泡泡不會進入共享足跡，配對資料由後端驗證成員權限。

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
  src/utils/              日期與音效工具
sync_us_app/              Python 後端
  database.py             Schema 與資料庫初始化
  services.py             核心商業邏輯與權限驗證
  simple_server.py        本機與正式靜態服務入口
  fastapi_app.py          FastAPI 路由介面
tests/                    行為驗證腳本
run_sync_us.py            應用程式啟動入口
```

## 本機啟動

需求：Python 3.11+、Node.js 20.19+ 或 22.12+。

```powershell
git clone https://github.com/Abralive/sync-us.git
cd sync-us\frontend
npm ci
npm run build
cd ..
python run_sync_us.py
```

瀏覽器開啟：<http://127.0.0.1:8051>

第一次啟動會在專案根目錄建立本機 SQLite 資料庫。資料庫、環境變數、建置產物與 `node_modules` 都不會提交到 Git。

## 驗證

```powershell
cd frontend
npm run build
cd ..
python -m compileall -q sync_us_app tests
python tests\verify_couple_invites.py
python tests\verify_connection_features.py
```

## 專案狀態

目前為持續開發中的產品原型，已完成帳號建立、伴侶邀請與配對、共同／私人泡泡、日期排程、長按完成、星塵回饋、對方小手冊與共同足跡等主要流程。

正式商用前仍需完成伺服器端密碼驗證、受管理的 PostgreSQL、物件儲存、監控、備份與完整自動化測試。

## 文件

- [產品企畫](01_Sync-Us_Proposal.md)
- [UX 改善計畫](05_Sync-Us_UX_Improvement_Plan.md)
- [伴侶連結設計](12_Sync-Us_Couple_Link_Phase1.md)
- [新電腦部署手冊](13_Sync-Us_New_PC_Deployment.md)

## License

本專案採用 [MIT License](LICENSE)。
