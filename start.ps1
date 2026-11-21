# ETH STALKING — local development launcher (Windows PowerShell)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'apps/server/.env')) { Copy-Item 'apps/server/.env.example' 'apps/server/.env'; Write-Host 'Created apps/server/.env from example' }
if (-not (Test-Path 'node_modules')) { npm install }
npm run db:migrate
if (-not (Test-Path 'data/app.db') -or ((Get-Item 'data/app.db').Length -lt 1)) { npm run db:seed }
npm run dev
