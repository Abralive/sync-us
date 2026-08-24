# Sync-Us 新電腦部署手冊（Windows）

本文件用於把目前的 Sync-Us 搬到另一台 Windows 電腦，並透過 `https://syncus.hunghung.xyz` 對外使用。

部署完成後的結構：

```text
手機或外部瀏覽器
    -> https://syncus.hunghung.xyz
    -> Cloudflare Tunnel
    -> 新電腦 127.0.0.1:8051
    -> Sync-Us Python 服務
    -> frontend/dist + sync_us.db
```

## 0. 搬移前先決定資料是否一起帶走

### 選項 A：從全新資料開始（建議目前使用）

不要複製任何 `.db` 檔。第一次啟動時，Sync-Us 會建立新的 `sync_us.db`，讓你和男朋友重新註冊、配對及填寫小手冊。

### 選項 B：保留目前帳號、配對和泡泡

先關閉舊電腦上的 Sync-Us，再把舊電腦專案根目錄的 `sync_us.db` 單獨複製到新電腦相同位置。

> 不要在服務仍執行時複製資料庫，否則可能取得不完整資料。

## 1. 舊電腦：確認最新版已上傳 GitHub

目前 GitHub Repo：`https://github.com/Abralive/sync-us.git`

先在舊電腦的專案目錄確認：

```powershell
cd C:\Users\user\Downloads\sync
git status
```

如果出現 `modified` 或 `untracked`，代表修改仍只存在舊電腦。必須先 commit 並 push，否則新電腦 clone 到的會是舊版本。

```powershell
git add .
git commit -m "Prepare Sync-Us for new PC deployment"
git push origin master
```

不要上傳以下內容：

- `frontend/node_modules/`
- `frontend/dist/`
- `*.db`
- `*.log`
- `.env*`
- Cloudflare Tunnel token

目前 `.gitignore` 已排除上述項目。

## 2. 新電腦：安裝必要工具

用 PowerShell 執行：

```powershell
winget install --id Git.Git
winget install --id Python.Python.3.14
winget install --id OpenJS.NodeJS.LTS
winget install --id Cloudflare.cloudflared
```

安裝完成後，關閉 PowerShell 再重新開啟，確認：

```powershell
git --version
python --version
node --version
npm --version
cloudflared --version
```

Node.js 建議使用目前的 LTS 版本；需符合 Vite 7 的需求。

## 3. 新電腦：下載程式碼

```powershell
cd $HOME\Downloads
git clone https://github.com/Abralive/sync-us.git
cd sync-us
```

如果 Repo 是 Private，GitHub 會要求登入或 Personal Access Token。

## 4. 建置 React 前端

```powershell
cd frontend
npm ci
npm run build
cd ..
```

`npm ci` 只在新電腦安裝相依套件，不會把整包 `node_modules` 放進 GitHub。

成功後應產生：

```text
frontend/dist/index.html
frontend/dist/assets/
```

## 5. 設定外部存取保護

目前 App 內的 Email 登入仍不是完整密碼驗證，因此網域外層需要保留 HTTP Basic Auth。

在新電腦 PowerShell 執行：

```powershell
$syncCredential = Get-Credential -Message "設定 Sync-Us 網域共用帳密"
[Environment]::SetEnvironmentVariable("SYNC_US_USER", $syncCredential.UserName, "User")
$syncPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($syncCredential.Password)
)
[Environment]::SetEnvironmentVariable("SYNC_US_PASS", $syncPassword, "User")
[Environment]::SetEnvironmentVariable("SYNC_US_HOST", "127.0.0.1", "User")
[Environment]::SetEnvironmentVariable("SYNC_US_PORT", "8051", "User")
Remove-Variable syncPassword
```

完成後關閉 PowerShell，再開新視窗，讓環境變數生效。

這組帳密是打開 `syncus.hunghung.xyz` 時瀏覽器最先詢問的帳密，可以只分享給你和男朋友。

## 6. 啟動 Sync-Us

```powershell
cd $HOME\Downloads\sync-us
python run_sync_us.py
```

看到服務啟動訊息後，先在新電腦測試：

```text
http://127.0.0.1:8051
```

瀏覽器應先要求輸入第 5 步設定的共用帳密，成功後才會看到 Sync-Us。

不要關閉這個 PowerShell 視窗，關閉後 App 服務就會停止。

## 7. 搬移資料庫（僅選項 B）

確認新電腦的 Sync-Us 已停止，再把舊電腦的：

```text
sync_us.db
```

複製到：

```text
C:\Users\你的帳號\Downloads\sync-us\sync_us.db
```

若要從全新資料開始，跳過此步驟。

## 8. 在新電腦啟動 Cloudflare Tunnel

### 重要：先撤銷舊 token

舊 Tunnel token 曾出現在對話與部署說明中，應視為已外流。請到 Cloudflare Zero Trust 重新產生 connector token，不要再使用舊 token。

操作路徑：

```text
Cloudflare Zero Trust
-> Networks
-> Tunnels
-> syncus
-> Add a replica / Install connector
-> Windows
```

確認 Public Hostname 設定為：

```text
Hostname: syncus.hunghung.xyz
Service:  http://localhost:8051
```

接著用「以系統管理員身分執行」的 PowerShell，貼上 Cloudflare 畫面提供的新指令：

```powershell
cloudflared.exe service install <新的 Tunnel token>
```

不要把 token 寫入 GitHub、Markdown、LINE 群組或公開截圖。

檢查服務：

```powershell
Get-Service cloudflared
```

狀態應為 `Running`。若不是：

```powershell
Start-Service cloudflared
```

若當地網路阻擋 QUIC，可在 Cloudflare 設定中改用 HTTP/2；不要建立第二條相同網域的 Tunnel。

## 9. 最終驗證

依序確認：

1. `http://127.0.0.1:8051` 能開啟。
2. 未輸入共用帳密時會顯示登入要求或 `401`。
3. `Get-Service cloudflared` 顯示 `Running`。
4. 手機關閉 Wi-Fi，改用 4G/5G 開啟 `https://syncus.hunghung.xyz`。
5. 輸入共用帳密後能看到 Sync-Us 登入畫面。
6. 建立兩個帳號、產生邀請碼並完成配對。
7. 重新整理後登入狀態仍保留。
8. 新增共同泡泡後，另一個帳號能看到資料。

## 10. 常見錯誤

### Cloudflare Error 1033

Tunnel 沒有連上 Cloudflare：

```powershell
Get-Service cloudflared
Restart-Service cloudflared
```

### 502 Bad Gateway

Tunnel 正常，但 Sync-Us 沒有在 8051 執行：

```powershell
Test-NetConnection 127.0.0.1 -Port 8051
```

如果 `TcpTestSucceeded` 是 `False`，重新執行：

```powershell
cd $HOME\Downloads\sync-us
python run_sync_us.py
```

### 網頁仍是舊版

重新建置前端，再用無痕視窗測試：

```powershell
cd $HOME\Downloads\sync-us\frontend
npm ci
npm run build
```

### `cloudflared service install` 顯示 Access denied

PowerShell 沒有用系統管理員身分執行。關閉後，從開始功能表右鍵 PowerShell，選擇「以系統管理員身分執行」。

### 電腦關機後能否使用

不能。Cloudflare Tunnel 只負責把外部流量帶到這台電腦；Sync-Us 與 SQLite 資料庫仍在新電腦上。新電腦關機、休眠、斷網或 Python 服務停止時，網域就無法使用。

## 11. 每次更新程式

新電腦更新流程：

```powershell
cd $HOME\Downloads\sync-us
git pull origin master
cd frontend
npm ci
npm run build
cd ..
```

接著重新啟動 `python run_sync_us.py`。資料保存在 `sync_us.db`，一般程式更新不應覆蓋它；更新前仍建議先備份資料庫。

## 12. 上線前最低安全要求

- Tunnel token 必須重新產生。
- 保留外層共用帳密。
- 不公開 `?review=1`；目前程式已限制它只能在 `localhost` 或 `127.0.0.1` 使用。
- 不把 `.db`、`.env`、密碼或 token 上傳 GitHub。
- 定期備份 `sync_us.db`。
- 真正商用前應把 Email 選擇登入改成伺服器端密碼驗證，並把 SQLite 遷移到受管理的 PostgreSQL。

## 最短部署清單

```text
[ ] 舊電腦 commit + push
[ ] 新電腦安裝 Git / Python / Node / cloudflared
[ ] git clone
[ ] frontend 執行 npm ci + npm run build
[ ] 設定 SYNC_US_USER / SYNC_US_PASS / HOST / PORT
[ ] python run_sync_us.py
[ ] 本機 8051 驗證
[ ] Cloudflare 重新產生 token
[ ] 管理員 PowerShell 安裝 Tunnel 服務
[ ] 手機 4G/5G 驗證 syncus.hunghung.xyz
```
