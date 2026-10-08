#Requires -Version 5.1
# Sync-Us 自動啟動：登入 Windows 時在背景啟動 Sync-Us，停止時自動重新啟動。
# 用法：雙擊同資料夾的 install_autostart.bat
$ErrorActionPreference = "Stop"
$TaskName = "Sync-Us"
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Port = if ($env:SYNC_US_PORT) { $env:SYNC_US_PORT } else { "8051" }
$CurrentUser = "$env:USERDOMAIN\$env:USERNAME"

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

function Read-EnvFile([string]$Path) {
  $values = @{}
  if (Test-Path $Path) {
    foreach ($line in Get-Content -Path $Path -Encoding UTF8) {
      if ($line -match '^\s*(SYNC_US_[A-Z_]+)\s*=\s*(.*)$') { $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
    }
  }
  return $values
}

Say ""
Say "== Sync-Us 自動啟動設定 ==" Cyan
Say "專案資料夾：$ProjectDir"

# 1. 找到 pythonw.exe（沒有黑色視窗的 Python）
$Pythonw = $null
foreach ($launcher in @("python", "py")) {
  if (-not (Get-Command $launcher -ErrorAction SilentlyContinue)) { continue }
  # Assign arrays directly: an if-expression would unroll @("-c") into a plain string.
  $pyArgs = @("-c")
  if ($launcher -eq "py") { $pyArgs = @("-3", "-c") }
  try {
    $exe = & $launcher @pyArgs "import sys; print(sys.executable)" 2>$null
  } catch {
    continue
  }
  if ($exe) {
    $candidate = Join-Path (Split-Path ([string]$exe).Trim()) "pythonw.exe"
    if (Test-Path $candidate) {
      $Pythonw = $candidate
      $version = & $launcher @pyArgs "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
      break
    }
  }
}
if (-not $Pythonw) {
  Say "找不到 pythonw.exe。請先安裝 Python 3.10 以上（winget install Python.Python.3.13），再重新執行。" Red
  exit 1
}
Say "Python：$Pythonw（$version）"
if ($version -and [version]$version -lt [version]"3.10") {
  Say "Sync-Us 需要 Python 3.10 以上，請先更新 Python。" Red
  exit 1
}

# 2. 前端是否已建置
if (-not (Test-Path (Join-Path $ProjectDir "frontend\dist\index.html"))) {
  Say "提醒：還沒有建置前端。請先在 frontend 資料夾執行 npm ci 和 npm run build。" Yellow
}

# 3. 外層帳號密碼（Basic Auth）
$envFile = Read-EnvFile (Join-Path $ProjectDir ".env")
$authUser = [Environment]::GetEnvironmentVariable("SYNC_US_USER", "User")
$authPass = [Environment]::GetEnvironmentVariable("SYNC_US_PASS", "User")
if ($authUser -and $authPass) {
  Say "外層帳密：已設定（帳號 $authUser）" Green
} elseif ($envFile["SYNC_US_USER"] -and $envFile["SYNC_US_PASS"]) {
  Say "外層帳密：已在 .env 檔設定（帳號 $($envFile["SYNC_US_USER"])）" Green
} else {
  Say "外層帳密還沒設定：沒有它，知道網址的人都能打開 Sync-Us。" Yellow
  $answer = Read-Host "現在設定嗎？(Y/n)"
  if ($answer -notmatch '^[nN]') {
    $name = (Read-Host "帳號（你和伴侶共用）").Trim()
    $secure = Read-Host "密碼" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    if ($name -and $plain) {
      [Environment]::SetEnvironmentVariable("SYNC_US_USER", $name, "User")
      [Environment]::SetEnvironmentVariable("SYNC_US_PASS", $plain, "User")
      Say "已儲存到這個 Windows 帳號的環境變數。" Green
    } else {
      Say "帳號或密碼是空的，先略過。之後可以重新執行這個檔案設定。" Yellow
    }
    Remove-Variable plain -ErrorAction SilentlyContinue
  }
}

# 4. 建立排程：登入時啟動，停止後自動重新啟動
$action = New-ScheduledTaskAction -Execute $Pythonw -Argument "run_sync_us.py --service" -WorkingDirectory $ProjectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
# Priority 4 = normal priority (the default 7 runs it below normal, so pages feel slow while the laptop is busy).
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew `
  -Priority 4
$principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Sync-Us 本機伺服器：登入時自動啟動，停止時自動重新啟動。" -Force | Out-Null
} catch {
  Say "建立排程失敗：$($_.Exception.Message)" Red
  Say "請在 install_autostart.bat 上按右鍵，選「以系統管理員身分執行」再試一次。" Yellow
  exit 1
}
Say "已建立排程「$TaskName」：之後每次登入 Windows 都會自動啟動。" Green

# 5. 現在就（重新）啟動並檢查：更新程式後重新執行這個檔案，也會換成新版本
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName $TaskName
$alive = $false
for ($i = 0; $i -lt 10 -and -not $alive; $i++) {
  Start-Sleep -Seconds 1
  $alive = Test-SyncUs $Port
}
if ($alive) {
  Say "Sync-Us 正在背景執行：http://127.0.0.1:$Port" Green
} else {
  Say "Sync-Us 還沒有回應。常見原因：8051 埠被另一個視窗佔用（例如手動開的 start_syncus_8051.bat）。" Yellow
  Say "關掉那個視窗後，排程會在一分鐘內自動接手。詳細原因可以執行 status.bat 查看。" Yellow
}

$cloudflared = Get-Service cloudflared -ErrorAction SilentlyContinue
if ($cloudflared) {
  Say "Cloudflare Tunnel 服務：$($cloudflared.Status)"
} else {
  Say "沒有找到 cloudflared 服務：外部網域需要 Cloudflare Tunnel（見 13_Sync-Us_New_PC_Deployment.md 第 8 步）。" Yellow
}
Say ""
Say "日誌：$ProjectDir\logs\sync_us.log"
Say "備份：$ProjectDir\backups（每天一份，保留 14 份）"
Say "要取消自動啟動，執行 uninstall_autostart.bat。"
