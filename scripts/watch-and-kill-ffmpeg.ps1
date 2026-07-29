param(
  [Parameter(Mandatory = $true)]
  [int]$WorkerPid,
  [int]$TimeoutSeconds = 90
)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  $ffmpeg = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq "ffmpeg.exe" -and $_.ParentProcessId -eq $WorkerPid } |
    Select-Object -First 1
  if ($ffmpeg) {
    [pscustomobject]@{
      killedAt = (Get-Date).ToUniversalTime().ToString("o")
      workerPid = $WorkerPid
      ffmpegPid = $ffmpeg.ProcessId
      ffmpegParentPid = $ffmpeg.ParentProcessId
      commandLine = $ffmpeg.CommandLine
    } | ConvertTo-Json -Compress
    Stop-Process -Id $WorkerPid -Force
    exit 0
  }
  Start-Sleep -Milliseconds 100
}

throw "Timed out waiting for an ffmpeg child of Worker PID $WorkerPid."
