# run-daily-fetch.ps1
#
# Runs once a day (via Windows Task Scheduler) to refresh the saved HubSpot
# activity numbers that the dashboard webpage reads.
#
# Each run pulls a rolling 90-day window (today and the 89 days before it)
# and overwrites data/activity.json. Re-pulling the same window each day —
# rather than only asking for "yesterday" — means the file heals itself if
# a run is ever missed (e.g., the computer was off), and the dashboard can
# always show "This Month", "Last Month", etc. without gaps.
#
# A short note is appended to logs/fetch-log.txt each run so you can check
# whether it's been working.

$ProjectDir = $PSScriptRoot

# Make sure the arrow/dash characters fetch-report.js prints come through
# readably in the log instead of as garbled symbols.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$LogDir  = Join-Path $ProjectDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'fetch-log.txt'

function Write-Log($text) {
  $text | Out-File -FilePath $LogFile -Append -Encoding utf8
}

Write-Log "`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') :: starting (running as $env:USERNAME, dir=$ProjectDir) ====="

try {
  $End   = Get-Date -Format 'yyyy-MM-dd'
  $Start = (Get-Date).AddDays(-89).ToString('yyyy-MM-dd')
  Write-Log "Fetching $Start to $End ..."

  $nodeCmd = Get-Command node -ErrorAction Stop
  Write-Log "Using node at: $($nodeCmd.Source)"

  Push-Location $ProjectDir
  try {
    $output = & $nodeCmd.Source 'fetch-report.js' $Start $End 2>&1 | Out-String
  } finally {
    Pop-Location
  }
  Write-Log $output
  Write-Log "Finished OK."
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  Write-Log ($_ | Out-String)
}
