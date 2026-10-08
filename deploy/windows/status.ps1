#Requires -Version 5.1
# 查看 Sync-Us 的狀態：網域打不開（例如 502）時先執行這個檔案。
$ErrorActionPreference = "Continue"
$TaskName = "Sync-Us"
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Port = if ($env:SYNC_US_PORT) { $env:SYNC_US_PORT } else { "8051" }

function Say([string]$Text, [string]$Color = "Gray") { Write-Host $Text -ForegroundColor $Color }

function Test-SyncUs([string]$Port) {
  # Any HTTP answer (200, or 401 when the password is on) means the server is running.
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$Port/api/v1/health" | Out-Null
    return $true
  } catch {
    return [bool]$_.Exception.Response
  }
}

Say ""
Say "== Sync-Us 狀態 ==" Cyan

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Say "自動啟動排程：$($task.State)，上次啟動 $($info.LastRunTime)，結果代碼 $($info.LastTaskResult)"
} else {
  Say "自動啟動排程：沒有設定（可以執行 install_autostart.bat）" Yellow
}

if (Test-SyncUs $Port) {
  Say "本機服務：正常（http://127.0.0.1:$Port）" Green
} else {
  Say "本機服務：沒有回應。這就是網域出現 502 的原因，請看下面的日誌。" Red
}
if (-not (Test-Path (Join-Path $ProjectDir "frontend\dist\index.html"))) {
  Say "前端：還沒有建置，網頁會是舊的或空白。請在 frontend 資料夾執行 npm ci 和 npm run build。" Yellow
}

$statusFile = Join-Path $ProjectDir "logs\status.json"
if (Test-Path $statusFile) {
  try {
    $state = Get-Content -Path $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($state.integrity_ok) {
      Say "資料庫檢查：正常（$($state.checked_at)）" Green
    } else {
      Say "資料庫檢查：沒有通過（$($state.checked_at)）：$($state.integrity_detail)" Red
      Say "已自動暫停備份與清理，backups 裡的備份都還在。先不要刪除任何檔案，請把這段訊息交給協助你的人。" Red
    }
  } catch {
    Say "資料庫檢查：讀不到 $statusFile" Yellow
  }
}

$cloudflared = Get-Service cloudflared -ErrorAction SilentlyContinue
if ($cloudflared) {
  $color = if ($cloudflared.Status -eq "Running") { "Green" } else { "Red" }
  Say "Cloudflare Tunnel：$($cloudflared.Status)" $color
} else {
  Say "Cloudflare Tunnel：沒有安裝 cloudflared 服務" Yellow
}

$backup = Get-ChildItem -Path (Join-Path $ProjectDir "backups") -Filter "sync_us-*.db" -ErrorAction SilentlyContinue |
  Sort-Object Name | Select-Object -Last 1
if ($backup) {
  Say "最新備份：$($backup.Name)（$($backup.LastWriteTime)）"
} else {
  Say "最新備份：還沒有" Yellow
}

$log = Join-Path $ProjectDir "logs\sync_us.log"
if (Test-Path $log) {
  Say ""
  Say "-- 最近的日誌 --" Cyan
  Get-Content -Path $log -Tail 25 -Encoding UTF8
} else {
  Say "還沒有日誌檔：$log" Yellow
}
