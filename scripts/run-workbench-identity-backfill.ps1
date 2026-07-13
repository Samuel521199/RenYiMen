param(
  [switch]$Apply,
  [switch]$NoCreateMissing,
  [string]$ReportPath = "",
  [string]$PlatformContainer = "workflow-db",
  [string]$PlatformDbUser = "postgres",
  [string]$PlatformDbName = "workflow",
  [string]$WorkbenchContainer = "workflow-workbench-db",
  [string]$WorkbenchDbUser = "ai_workbench",
  [string]$WorkbenchDbName = "ai_workbench"
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "workbench-identity-backfill.mjs"
if (-not (Test-Path $scriptPath)) {
  throw "Script not found: $scriptPath"
}

$args = @(
  $scriptPath,
  "--platform-container", $PlatformContainer,
  "--platform-db-user", $PlatformDbUser,
  "--platform-db-name", $PlatformDbName,
  "--workbench-container", $WorkbenchContainer,
  "--workbench-db-user", $WorkbenchDbUser,
  "--workbench-db-name", $WorkbenchDbName
)

if ($Apply) {
  $args += "--apply"
} else {
  $args += "--dry-run"
}

if ($NoCreateMissing) {
  $args += "--no-create-missing"
}

if ($ReportPath -ne "") {
  $args += "--report"
  $args += $ReportPath
}

Write-Host "Running identity backfill..."
Write-Host "node $($args -join ' ')"
node @args
