# Workbench User Unification - Phase 2 Step 1

This step provides a full backfill script that links platform users (`workflow.users`) to workbench users (`ai_workbench.users`) and generates a conflict report.

## What this script does

- Reads platform users from Docker DB container `workflow-db` (`workflow` database).
- Reads workbench users from Docker DB container `workflow-workbench-db` (`ai_workbench` database).
- Matches users in this priority:
  1. `platform_user_id`
  2. `email` (case-insensitive)
  3. legacy username derived from email local-part
- Produces a JSON report with:
  - planned updates
  - planned creates
  - conflict list
  - unmatched platform users
  - orphan workbench users
- Supports dry-run and apply modes.

## One-click commands

### Dry-run (recommended first)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-identity-backfill.ps1
```

### Apply changes

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-identity-backfill.ps1 -Apply
```

### Apply without creating missing workbench users

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-identity-backfill.ps1 -Apply -NoCreateMissing
```

## Report location

By default:

`reports/workbench-identity-backfill-<timestamp>.json`

You can override it:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-identity-backfill.ps1 -ReportPath .\reports\backfill-latest.json
```
