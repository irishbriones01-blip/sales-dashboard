# run-daily-fetch.ps1
#
# Runs once a day (via Windows Task Scheduler) to refresh the saved report
# numbers that the dashboard webpage reads — and then sends the fresh
# numbers up to the published website (GitHub Pages) so the live page never
# goes stale. Two sources are refreshed each run:
#
#  1. HubSpot — pulls a rolling 90-day window (today and the 89 days before
#     it) and overwrites data/activity.json. Re-pulling the same window each
#     day, rather than only asking for "yesterday", means the file heals
#     itself if a run is ever missed (e.g., the computer was off).
#
#  2. Excel exports — re-converts whatever's currently saved in imports/
#     (Sales Activities / Bulk / Team Store, exported from SharePoint) into
#     data/report-*.json. So whenever you save fresh exports into imports/,
#     the very next scheduled run picks them up and publishes them — no
#     extra steps needed.
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
  Write-Log "HubSpot fetch finished OK."

  Write-Log "Re-converting Excel exports from imports/ (Sales Activities / Bulk / Team Store) ..."
  Push-Location $ProjectDir
  try {
    $importOutput = & $nodeCmd.Source 'import-excel-reports.js' 2>&1 | Out-String
  } finally {
    Pop-Location
  }
  Write-Log $importOutput

  Write-Log "Publishing the refreshed numbers to the live website..."

  $gitCmd = (Get-Command git -ErrorAction Stop).Source
  $dataFiles = @('data/activity.json', 'data/report-activities.json', 'data/report-bulk.json', 'data/report-team-store.json')
  Push-Location $ProjectDir
  try {
    & $gitCmd add $dataFiles | Out-Null
    $changed = & $gitCmd status --porcelain -- $dataFiles
    if ($changed) {
      & $gitCmd commit -m "Daily data refresh: $End" 2>&1 | Out-String | ForEach-Object { Write-Log $_ }
      $pushOutput = & $gitCmd push origin main 2>&1 | Out-String
      Write-Log $pushOutput
      Write-Log "Published today's numbers to the live website."
    } else {
      Write-Log "Numbers are unchanged since last time — nothing new to publish."
    }
  } finally {
    Pop-Location
  }

  Write-Log "All done."
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  Write-Log ($_ | Out-String)
}
