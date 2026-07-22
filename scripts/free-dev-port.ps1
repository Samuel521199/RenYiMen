param(
  [int]$Port = 3001
)

$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $connections) {
  Write-Host "Port $Port is free."
  exit 0
}

$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $processIds) {
  Write-Host "Stopping process $processId that is listening on port $Port..."
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

$stillListening = $null
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  $stillListening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $stillListening) {
    break
  }
}
if ($stillListening) {
  Write-Error "Port $Port is still in use after cleanup."
  exit 1
}

Write-Host "Port $Port is ready."
