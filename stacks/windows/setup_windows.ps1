# =========================================================
# Datei:      stacks/windows/setup_windows.ps1
# Zweck:      Setup des Windows-Hosts (Blueprint v1.2.0, optional)
# Host:       Windows 192.168.178.60
#             TS-Server (Docker) · Genetic Optimizer · Academy
#             React-Dashboard (Vite / :3000) · NFS Z:\data
# Aufruf:     powershell -ExecutionPolicy Bypass -File setup_windows.ps1
# =========================================================
param(
  [string]$CoreIp = "192.168.178.50",
  [string]$RepoPath = "C:\Projekt_Alpha",
  [string]$NfsShare = "/srv/alpha/data"
)

$ErrorActionPreference = "Stop"
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  PROJEKT:ALPHA — WINDOWS-HOST SETUP (Blueprint v1.2.0)" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# 1. Docker prüfen
try {
  docker --version | Out-Null
  Write-Host "  [OK] Docker vorhanden" -ForegroundColor Green
} catch {
  Write-Host "  [FEHLER] Docker Desktop nicht installiert — https://docker.com/products/docker-desktop" -ForegroundColor Red
  exit 1
}

# 2. NFS-Client aktivieren (Windows 10/11: Feature "Client for NFS")
Write-Host "`n[1/4] NFS-Client aktivieren..." -ForegroundColor Yellow
$cap = Get-WindowsCapability -Online | Where-Object { $_.Name -like "*NFS.Client*" }
if ($cap -and $cap.State -ne "Installed") {
  Add-WindowsCapability -Online -Name $cap.Name | Out-Null
  Write-Host "  NFS-Client installiert — NEUSTART ERFORDERLICH, falls nicht aktiv." -ForegroundColor Yellow
} else {
  Write-Host "  [OK] NFS-Client vorhanden" -ForegroundColor Green
}

# 3. NFS-Mount Z:\data (Ubuntu-Core exportiert /srv/alpha/data)
Write-Host "`n[2/4] NFS-Mount Z: anlegen (Quelle ${CoreIp}${NfsShare})..." -ForegroundColor Yellow
try {
  $existing = Get-NfsClientMapping -ErrorAction Stop | Where-Object { $_.LocalPath -eq "Z:" }
  if (-not $existing) {
    New-NfsMapping -Server $CoreIp -Share $NfsShare -LocalPath "Z:" -ErrorAction Stop | Out-Null
    Write-Host "  [OK] Z: = ${CoreIp}${NfsShare}" -ForegroundColor Green
  } else {
    Write-Host "  [OK] Z: bereits gemountet" -ForegroundColor Green
  }
} catch {
  Write-Host "  [WARNUNG] NFS-Mount fehlgeschlagen: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "  Manuelles Fallback: mount -o nolock \\${CoreIp}${NfsShare} Z:" -ForegroundColor Yellow
}

# 4. Repo + Compose-Stack starten
Write-Host "`n[3/4] Repo nach ${RepoPath} kopieren..." -ForegroundColor Yellow
if (-not (Test-Path $RepoPath)) {
  New-Item -ItemType Directory -Path $RepoPath -Force | Out-Null
  Write-Host "  Bitte das Projekt:Alpha-Repo nach ${RepoPath} kopieren" -ForegroundColor Yellow
  Write-Host "  (z.B. git clone oder aus dem Ubuntu-Core synchronisieren)." -ForegroundColor Yellow
  exit 2
}

Write-Host "`n[4/4] Docker-Compose-Stack starten..." -ForegroundColor Yellow
$env:ALPHA_CORE_URL = "http://${CoreIp}:8000"
Push-Location (Join-Path $RepoPath "stacks\windows")
try {
  docker compose up -d --build
  Start-Sleep -Seconds 8
  docker compose ps
} finally {
  Pop-Location
}

Write-Host "`n=========================================================" -ForegroundColor Cyan
Write-Host "  WINDOWS-HOST BEREIT (192.168.178.60)" -ForegroundColor Cyan
Write-Host "  Dashboard:      http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Portal-Health:  http://localhost:3000/api/healthz" -ForegroundColor Cyan
Write-Host "  GA-Engine:      POST /api/genetic/run (WFO/DSR, TS)" -ForegroundColor Cyan
Write-Host "  Academy:        GET  /api/academy/strategies" -ForegroundColor Cyan
Write-Host "  Core-Proxy:     ALPHA_CORE_URL=http://${CoreIp}:8000" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Start-Process "http://localhost:3000"
