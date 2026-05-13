#Requires -Version 5.1
<#
  在项目根生成 prisma-for-server.zip / prisma-for-server.tar.gz，
  内含 prisma/migrations（全部子目录与 migration.sql）以及 prisma/schema.prisma（migrate deploy 必需）。

  用法（在仓库根目录）:
    powershell -ExecutionPolicy Bypass -File .\scripts\pack-prisma-for-deploy.ps1
#>
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$PrismaDir = Join-Path $Root "prisma"
$Migrations = Join-Path $PrismaDir "migrations"
$Schema = Join-Path $PrismaDir "schema.prisma"

if (-not (Test-Path $Schema)) { throw "Missing: $Schema" }
if (-not (Test-Path $Migrations)) { throw "Missing: $Migrations" }

$ZipOut = Join-Path $Root "prisma-for-server.zip"
$TgzOut = Join-Path $Root "prisma-for-server.tar.gz"

Remove-Item $ZipOut, $TgzOut -ErrorAction SilentlyContinue

Push-Location $PrismaDir
try {
  Compress-Archive -Path "migrations", "schema.prisma" -DestinationPath $ZipOut -Force
  # Windows 10+ 自带 tar：便于 Linux 上一条命令解压
  & tar -czf $TgzOut migrations schema.prisma
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "OK: $ZipOut"
Write-Host "OK: $TgzOut"
Write-Host ""
Write-Host "=== 上传到服务器后解压（二选一）==="
Write-Host "ZIP:"
Write-Host "  mkdir -p /opt/workflow/prisma && unzip -o /path/to/prisma-for-server.zip -d /opt/workflow/prisma"
Write-Host "tar.gz:"
Write-Host "  mkdir -p /opt/workflow/prisma && tar -xzf /path/to/prisma-for-server.tar.gz -C /opt/workflow/prisma"
Write-Host ""
Write-Host "校验:"
Write-Host "  ls -la /opt/workflow/prisma/schema.prisma /opt/workflow/prisma/migrations"
Write-Host ""
