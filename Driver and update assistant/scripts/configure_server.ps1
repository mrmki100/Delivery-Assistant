# PowerShell Server Configuration Script for Delivery Assistant Admin Server
[CmdletBinding()]
param(
    [int]$Port = 8088
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = (Resolve-Path "$ScriptDir\..").Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Configuring Delivery Assistant Admin Server            " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Setup Config
$ServerToml = "$ProjectDir\config\server.toml"
$ServerExample = "$ProjectDir\config\server.example.toml"
if (-not (Test-Path $ServerToml)) {
    Copy-Item $ServerExample $ServerToml
    Write-Host "[OK] Created config/server.toml from template" -ForegroundColor Green
}

# 2. Setup Data & Releases Directories
@("$ProjectDir\data", "$ProjectDir\releases", "$ProjectDir\data\keys") | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
    }
}
Write-Host "[OK] Data and release directories verified" -ForegroundColor Green

# 3. Add Firewall Rule (Requires Elevation)
Write-Host "[*] Configuring Windows Firewall rule for port $Port..."
try {
    netsh advfirewall firewall add rule name="DeliveryAssistant_AdminServer" dir=in action=allow protocol=TCP localport=$Port profile=private,domain 2>$null | Out-Null
    Write-Host "[OK] Firewall rule 'DeliveryAssistant_AdminServer' added for port $Port" -ForegroundColor Green
} catch {
    Write-Warning "Could not configure firewall rule. Elevation may be required."
}

Write-Host "`nServer configuration complete. To start the server, execute:" -ForegroundColor Cyan
Write-Host "  python -m driver_update_assistant.server.app`n" -ForegroundColor White
