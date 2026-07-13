param(
  [switch]$NoStrict,
  [int]$SinceHours = 168,
  [int]$MaxPlatformMissing = 0,
  [int]$MaxPotentialConflicts = 0,
  [int]$MaxUnboundWorkbench = 0,
  [int]$MaxRoleDrift = 0,
  [int]$MaxEmailDrift = 0,
  [int]$MaxRecentConflictAuditLogs = 0,
  [int]$MaxOpenConflictTickets = 0,
  [string]$ReportPath = "",
  [string]$PlatformContainer = "workflow-db",
  [string]$PlatformDbUser = "postgres",
  [string]$PlatformDbName = "workflow",
  [string]$WorkbenchContainer = "workflow-workbench-db",
  [string]$WorkbenchDbUser = "ai_workbench",
  [string]$WorkbenchDbName = "ai_workbench"
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "workbench-predeploy-identity-check.mjs"
if (-not (Test-Path $scriptPath)) {
  throw "Script not found: $scriptPath"
}

$args = @(
  $scriptPath,
  "--since-hours", $SinceHours,
  "--max-platform-missing", $MaxPlatformMissing,
  "--max-potential-conflicts", $MaxPotentialConflicts,
  "--max-unbound-workbench", $MaxUnboundWorkbench,
  "--max-role-drift", $MaxRoleDrift,
  "--max-email-drift", $MaxEmailDrift,
  "--max-recent-conflict-audit-logs", $MaxRecentConflictAuditLogs,
  "--max-open-conflict-tickets", $MaxOpenConflictTickets,
  "--platform-container", $PlatformContainer,
  "--platform-db-user", $PlatformDbUser,
  "--platform-db-name", $PlatformDbName,
  "--workbench-container", $WorkbenchContainer,
  "--workbench-db-user", $WorkbenchDbUser,
  "--workbench-db-name", $WorkbenchDbName
)

if ($NoStrict) {
  $args += "--no-strict"
} else {
  $args += "--strict"
}

if ($ReportPath -ne "") {
  $args += "--report"
  $args += $ReportPath
}

Write-Host "Running workbench predeploy identity check..."
Write-Host "node $($args -join ' ')"
node @args
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
  throw "Predeploy identity check failed with exit code $exitCode"
}
