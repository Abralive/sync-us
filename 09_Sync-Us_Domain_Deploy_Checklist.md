# Sync-Us 網域上線檢查

Sync-Us 正式網域目標：

- Public URL: `https://syncus.hunghung.xyz`
- Local service: `http://localhost:8051`
- Tunnel provider: Cloudflare Tunnel

## 本機服務

建議設定成登入 Windows 後自動在背景啟動（只需要做一次）：

```text
deploy\windows\install_autostart.bat
```

手動啟動（關掉視窗就會停止）：

```powershell
cd C:\Users\user\Downloads\sync
.\start_syncus_8051.bat
```

Sync-Us 預設只監聽 `127.0.0.1:8051`，外部連線一律經過 Cloudflare Tunnel。

確認本機服務與最近的日誌：

```text
deploy\windows\status.bat
```

或：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8051/robots.txt
```

回傳 `200` 代表 Cloudflare Tunnel 可以轉進這台電腦的 Sync-Us 服務。網域出現 502 時，先看 `status.bat` 的結果。

## Cloudflare Tunnel

這台電腦應安裝的是 `syncus.hunghung.xyz` 對應的 tunnel。

檢查服務：

```powershell
Get-Service cloudflared
```

重啟服務：

```powershell
Restart-Service cloudflared
```

> 注意：tunnel install token 是機密，不要寫進 GitHub、文件或聊天記錄。

## 上線前必檢

- `http://localhost:8051/` 本機可開
- `https://syncus.hunghung.xyz` 外部可開
- `?review=1` 測試模式不可作為正式入口
- API 使用 same-origin `/api/v1`，不要寫死 `127.0.0.1`
- 手機版檢查 `375px / 390px / 430px`
- 若不是公開展示，需加 Cloudflare Access 或正式登入保護
- 已設定外層帳密（`SYNC_US_USER` / `SYNC_US_PASS`），啟動日誌沒有「沒有設定」的警告
- `backups` 資料夾每天有新的備份（啟動時與每 24 小時自動備份，保留 14 份）
