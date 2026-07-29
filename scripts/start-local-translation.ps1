$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$serviceRoot = Join-Path $projectRoot ".local-services"
$venvRoot = Join-Path $serviceRoot "libretranslate-venv"
$pythonExe = Join-Path $venvRoot "Scripts\python.exe"
$serverExe = Join-Path $venvRoot "Scripts\libretranslate.exe"
$stdoutLog = Join-Path $serviceRoot "libretranslate.stdout.log"
$stderrLog = Join-Path $serviceRoot "libretranslate.stderr.log"

if (-not (Test-Path -LiteralPath $pythonExe)) {
  New-Item -ItemType Directory -Force -Path $serviceRoot | Out-Null
  & python -m venv $venvRoot
}

if (-not (Test-Path -LiteralPath $serverExe)) {
  $env:PIP_PROGRESS_BAR = "off"
  $env:PYTHONUTF8 = "1"
  & $pythonExe -m pip install --disable-pip-version-check --no-color "libretranslate==1.9.6"
}

try {
  Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5000/languages" -TimeoutSec 2 | Out-Null
  Write-Output "LibreTranslate is already running at http://127.0.0.1:5000"
  exit 0
} catch {
  # Start the local service below.
}

$process = Start-Process `
  -FilePath $serverExe `
  -ArgumentList @(
    "--host", "127.0.0.1",
    "--port", "5000",
    "--load-only", "en,zh",
    "--disable-web-ui",
    "--translation-cache", "all",
    "--threads", "4"
  ) `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Write-Output "Started LibreTranslate process $($process.Id). First startup downloads the zh/en packages."
Write-Output "Logs: $stdoutLog and $stderrLog"
