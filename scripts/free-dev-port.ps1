param(
  [int]$Port = 3001
)

function Get-ListeningProcessIds {
  param([int]$TargetPort)

  $ids = @()
  $connections = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
  if ($connections) {
    $ids += $connections | Select-Object -ExpandProperty OwningProcess
  }

  $escapedPort = [regex]::Escape($TargetPort.ToString())
  $ids += netstat -ano | ForEach-Object {
    if ($_ -match "^\s*TCP\s+\S+:$escapedPort\s+\S+\s+LISTENING\s+(\d+)\s*$") {
      [int]$Matches[1]
    }
  }

  $ids | Where-Object { $_ -gt 0 } | Sort-Object -Unique
}

$processIds = @(Get-ListeningProcessIds -TargetPort $Port)
if ($processIds.Count -eq 0) {
  Write-Host "Port $Port is free."
  exit 0
}

foreach ($processId in $processIds) {
  Write-Host "Stopping process $processId that is listening on port $Port..."
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

$stillListening = @()
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  $stillListening = @(Get-ListeningProcessIds -TargetPort $Port)
  if ($stillListening.Count -eq 0) {
    break
  }
}

if ($stillListening.Count -gt 0) {
  Write-Error "Port $Port is still in use after cleanup."
  exit 1
}

Write-Host "Port $Port is ready."
