#Requires -Version 5.1
# 取消 Sync-Us 自動啟動（不會刪除資料庫、備份或帳密設定）。
$TaskName = "Sync-Us"

function Say([string]$Text, [string]$Color = "Gray") { Write-Host $Text -ForegroundColor $Color }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Say "沒有找到「$TaskName」排程，不需要移除。" Yellow
  exit 0
}
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Say "已停止並移除自動啟動。資料庫、備份與外層帳密都還在。" Green
Say "之後要手動啟動，執行專案根目錄的 start_syncus_8051.bat。"
