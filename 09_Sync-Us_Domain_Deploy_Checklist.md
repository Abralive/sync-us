# Sync-Us 網域上線檢查

Sync-Us 正式網域目標：

- Public URL: `https://syncus.hunghung.xyz`
- Local service: `http://localhost:8051`
- Tunnel provider: Cloudflare Tunnel

## 本機服務

啟動 Sync-Us：

```powershell
cd C:\Users\user\Downloads\sync
.\start_sync_us.bat
```

或直接指定 port：

```powershell
$env:SYNC_US_PORT = "8051"
$env:SYNC_US_HOST = "0.0.0.0"
python run_sync_us.py
```

確認本機服務：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8051/
```

回傳 `200` 代表 Cloudflare Tunnel 可以轉進這台電腦的 Sync-Us 服務。

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
- SQLite 正式使用前要有備份策略
