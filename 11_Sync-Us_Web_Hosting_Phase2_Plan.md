# Sync-Us 網站架設學習與第二階段完成計畫

日期：2026-08-11  
目標：理解網站到底怎麼被放到網路上，並在今天完成「第二階段：本機服務可被網域或同網路手機穩定存取」。

---

## 1. 先釐清：架站其實分成三件事

很多人說「架網站」，其實混在一起講了三層東西：

| 層級 | 你要解決的問題 | 常見工具 |
|---|---|---|
| 前端 | 使用者看到的畫面在哪裡被提供 | Vite build、Nginx、Vercel、Cloudflare Pages |
| 後端 / API | 資料、登入、任務、配對邏輯在哪裡跑 | FastAPI、Node、Docker、VPS、Render、Railway |
| 網路入口 | 別人輸入網址後怎麼找到你的服務 | DNS、Cloudflare、Nginx、Tunnel、HTTPS |

Sync-Us 目前不是單純靜態網站，因為它有使用者、配對、泡泡、星塵、共同足跡與 SQLite 資料庫，所以它需要「後端服務」持續運作。

---

## 2. 為什麼需要 DNS

DNS 是網路上的地址簿。

使用者不會記 `192.168.x.x` 或某台機器的 IP，而是輸入：

```text
https://syncus.hunghung.xyz
```

DNS 的工作是告訴瀏覽器：

```text
syncus.hunghung.xyz 要去找哪一個伺服器或哪一條 tunnel
```

沒有 DNS 的話，使用者通常只能用：

```text
http://127.0.0.1:8051
http://你的區網IP:8051
```

這只能自己或同網路的人測試，不適合正式公開。

---

## 3. 為什麼需要 Cloudflare

Cloudflare 不是必要，但它常被用來解決這些問題：

| 問題 | Cloudflare 可以做什麼 |
|---|---|
| 不想暴露家裡 IP | 用 Cloudflare Tunnel 讓外部網址轉進本機服務 |
| 不想自己弄 HTTPS 憑證 | Cloudflare 自動提供 HTTPS |
| 沒有固定 IP | Tunnel 不需要固定 IP |
| 不想開防火牆 port | Tunnel 由本機主動連出去，不需要 port forwarding |
| 想加登入保護 | Cloudflare Access 可以限制 Email 登入 |

但要注意：Cloudflare Tunnel 不是把網站搬到雲端。

如果 Sync-Us 是透過 Cloudflare Tunnel 連到你這台 Windows 電腦，那你的電腦必須：

- 開機
- 連網
- Sync-Us 服務正在跑
- cloudflared tunnel 正在跑

只要其中一個停了，外面的人就連不上。

---

## 4. 自己架網站的主要方法

### 方法 A：本機開發

適合：自己開發、自己測試。

```text
你的電腦
→ http://127.0.0.1:8051
```

優點：最快、最簡單。  
缺點：只有自己看得到。

Sync-Us 目前本機主要就是這種模式。

---

### 方法 B：同一個 Wi-Fi 手機測試

適合：你想在自己的手機上看 App 效果。

```text
你的電腦
→ 監聽 0.0.0.0:8051
→ 手機打開 http://電腦區網IP:8051
```

優點：最適合手機版 UI 測試。  
缺點：只能同一個網路，出門就不能用。

---

### 方法 C：Cloudflare Tunnel

適合：短期展示、讓男朋友或外部測試者打開網址試用。

```text
syncus.hunghung.xyz
→ Cloudflare DNS
→ Cloudflare Tunnel
→ 你的電腦 localhost:8051
```

優點：不用固定 IP、不用開 port、有 HTTPS。  
缺點：你的電腦關機就不能用；公司、學校或某些網路可能會擋 tunnel。

Sync-Us 目前規劃的 `syncus.hunghung.xyz` 就是這種。

---

### 方法 D：PaaS / Managed Cloud

適合：想快速讓產品穩定上線，不想自己管太多伺服器。

常見組合：

```text
前端：Vercel / Cloudflare Pages
後端：Render / Railway / Fly.io
資料庫：Supabase / Neon Postgres
```

優點：上線快、比較穩、比較適合正式測試。  
缺點：要理解部署設定、環境變數、資料庫遷移。

如果 Sync-Us 要給真實使用者長期使用，這會比 Cloudflare Tunnel 更合理。

---

### 方法 E：自己租 VPS

適合：想真正理解伺服器、部署、安全、維運的人。

```text
Domain DNS
→ VPS Public IP
→ Nginx
→ FastAPI / Node / Docker
→ PostgreSQL
```

優點：自由度最高，學會後技術層次會明顯提升。  
缺點：你要自己處理安全更新、防火牆、SSL、備份、監控、資料庫維護。

這確實是在講「後端與伺服器」。學會這套，你會比只會寫前端畫面的人更理解產品怎麼真正上線。

---

### 方法 F：NAS / 家裡主機自架

適合：技術玩家、家庭伺服器。

```text
家裡主機 / NAS
→ 路由器 port forwarding
→ DDNS / 固定 IP
→ Domain
```

優點：資料在自己機器。  
缺點：最麻煩，也最容易遇到斷線、資安、路由器、電力與備份問題。

不建議 Sync-Us 初期用這個當正式服務。

---

## 5. Sync-Us 目前狀態判斷

目前 Sync-Us 比較像：

```text
本機 App + 後端服務 + SQLite 資料庫
```

目前本機服務應跑在：

```text
http://127.0.0.1:8051
```

若要透過網域：

```text
https://syncus.hunghung.xyz
→ Cloudflare Tunnel
→ http://localhost:8051
```

所以如果網域上不去，常見原因是：

1. Sync-Us 本機服務沒有跑在 `8051`。
2. cloudflared 沒有啟動。
3. Windows 服務沒有管理員權限安裝成功。
4. 目前網路擋住 Cloudflare Tunnel 連線。
5. Cloudflare 後台的 Public Hostname 指到錯誤 port。
6. 本機電腦關機或睡眠。

---

## 6. 今天完成到第二階段

### 階段 1：本機可用

完成標準：

- [ ] `http://127.0.0.1:8051` 可以打開 Sync-Us。
- [ ] 可以註冊第一個使用者。
- [ ] 可以登出後註冊第二個使用者。
- [ ] 可以建立配對。
- [ ] 可以建立泡泡。
- [ ] 首頁星域可以長按戳破泡泡。

檢查指令：

```powershell
cd C:\Users\user\Downloads\sync
python run_sync_us.py
```

另一個 PowerShell 檢查：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8051/api/v1/health
```

---

### 階段 2：手機或網域可試用

今天要做到的第二階段，不是正式 App Store 上架，而是「真機可以用、外部入口邏輯清楚」。

完成標準：

- [ ] 電腦與手機連同一個 Wi-Fi。
- [ ] Sync-Us 服務監聽 `0.0.0.0:8051`。
- [ ] 手機能打開 `http://電腦區網IP:8051`。
- [ ] 如果使用 Cloudflare Tunnel，`https://syncus.hunghung.xyz` 能連到同一個服務。
- [ ] 若網域不能用，能明確判斷是本機服務、tunnel、DNS 還是網路阻擋。
- [ ] 不使用 `?review=1` 進行正式帳號設定。
- [ ] 資料庫已歸零，可讓你和男朋友重新註冊與配對。

取得電腦區網 IP：

```powershell
ipconfig
```

找 `IPv4 Address`，通常長得像：

```text
192.168.1.23
```

手機瀏覽器輸入：

```text
http://192.168.1.23:8051
```

Cloudflare Tunnel 檢查：

```powershell
Get-Service cloudflared
```

如果服務存在但網域連不上：

```powershell
Restart-Service cloudflared
```

---

## 7. 第二階段驗收流程

請照這個順序測，不要跳著測。

### A. 本機服務

- [ ] 電腦開 `http://127.0.0.1:8051`
- [ ] 不要使用舊的 `http://127.0.0.1:8000`
- [ ] 不要使用 `?review=1`

### B. 帳號與配對

- [ ] 你註冊自己的帳號。
- [ ] 登出。
- [ ] 男朋友註冊自己的帳號。
- [ ] 其中一方進入「連結」建立配對。

### C. 泡泡流程

- [ ] 建立共享泡泡。
- [ ] 建立私人泡泡。
- [ ] 回到首頁星域。
- [ ] 只有首頁星域可以長按戳破泡泡。
- [ ] 泡泡頁只負責清單、搜尋、篩選與安排，不直接完成。

### D. 共同足跡

- [ ] 完成共享泡泡後，連結頁出現共同足跡。
- [ ] 私人泡泡不會出現在共同足跡。
- [ ] 同一顆泡泡不會重複產生兩筆足跡。

### E. 手機顯示

- [ ] 375px 寬度沒有水平捲動。
- [ ] 底部導覽不遮住主要內容。
- [ ] 首頁第一眼看得到星球軌道與主要泡泡。

### F. 網域入口

- [ ] `http://127.0.0.1:8051` 本機可用。
- [ ] `http://電腦區網IP:8051` 手機可用。
- [ ] `https://syncus.hunghung.xyz` 可用。

若前兩個可用、第三個不可用，問題多半在 Cloudflare Tunnel 或 DNS，不是 App 本身。

---

## 8. 第二階段不做什麼

今天不要把範圍擴大到這些：

- App Store 正式上架。
- iOS 原生 App。
- Android 原生 App。
- 完整商業會員系統。
- 正式金流。
- 大量 AI Agent 自動營運。
- VPS 長期維運。

這些是第三階段以後的事。

---

## 9. 第三階段建議

第二階段完成後，下一步應該選一條正式路線：

### 路線 A：快速產品驗證

```text
Vercel / Cloudflare Pages
Render / Railway
Supabase / Neon Postgres
```

適合先給真實使用者測。

### 路線 B：工程能力升級

```text
VPS
Docker
Nginx
PostgreSQL
HTTPS
Backup
Monitoring
```

適合你想完整學會真正的後端部署與伺服器維運。

### 路線 C：App Store 準備

```text
PWA / Capacitor
iOS Developer Account
隱私權政策
資料刪除機制
正式登入與安全規則
```

適合 Sync-Us 要從網頁走向手機 App 上架。

---

## 10. 今天的結論

今天的目標不是一次把 Sync-Us 變成正式商業級服務，而是完成第二階段：

```text
本機可跑
手機可測
網域邏輯清楚
帳號資料歸零
你和男朋友可以重新註冊、配對、建立泡泡、戳破泡泡
```

只要這些完成，Sync-Us 就從「只能在開發環境看的作品」進到「可以給另一個人真實試用的產品雛形」。
