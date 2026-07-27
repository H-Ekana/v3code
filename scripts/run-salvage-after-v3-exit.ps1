param(
  [Parameter(Mandatory = $true)]
  [string]$ThreadIds
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repoRoot ".thread-salvage"
$logPath = Join-Path $logDirectory "watcher.log"

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location $repoRoot
$env:NODE_NO_WARNINGS = "1"

$arguments = @(
  "scripts/salvage-codex-threads.mjs",
  "--apply",
  "--wait-for-exit"
)
foreach ($threadId in $ThreadIds.Split(",", [System.StringSplitOptions]::RemoveEmptyEntries)) {
  $arguments += @("--thread", $threadId.Trim())
}

& "C:\Program Files\nodejs\node.exe" @arguments *>&1 |
  Tee-Object -FilePath $logPath

exit $LASTEXITCODE
