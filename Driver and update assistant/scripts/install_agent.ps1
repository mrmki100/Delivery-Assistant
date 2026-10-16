# PowerShell Agent Installation Script for Delivery Assistant Update Agent
[CmdletBinding()]
param()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = (Resolve-Path "$ScriptDir\..").Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Installing Delivery Assistant Windows Update Agent     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Detect Standalone Executable or Python Runtime
$ExePath = ""
if (Test-Path "$ProjectDir\dist\client\DriverUpdateAssistant-Client\DriverUpdateAssistant-Client.exe") {
    $ExePath = "$ProjectDir\dist\client\DriverUpdateAssistant-Client\DriverUpdateAssistant-Client.exe"
} elseif (Test-Path "$ProjectDir\DriverUpdateAssistant-Client.exe") {
    $ExePath = "$ProjectDir\DriverUpdateAssistant-Client.exe"
}

if ($ExePath) {
    Write-Host "[OK] Detected Standalone Client Executable: $ExePath" -ForegroundColor Green
    $HostPath = $ExePath
} else {
    $PythonExe = Get-Command python -ErrorAction SilentlyContinue
    if (-not $PythonExe) {
        Write-Error "Neither DriverUpdateAssistant-Client.exe nor Python was found. Please build the client binary or install Python 3.10+."
        exit 1
    }
    $PyVersion = python --version 2>&1
    Write-Host "[OK] Standalone EXE not found; using Python environment: $PyVersion" -ForegroundColor Yellow
    $HostPath = "$ProjectDir\scripts\host_runner.bat"
}

# 2. Setup Configuration
$AgentToml = "$ProjectDir\config\agent.toml"
$AgentExample = "$ProjectDir\config\agent.example.toml"
if (-not (Test-Path $AgentToml)) {
    if (Test-Path $AgentExample) {
        Copy-Item $AgentExample $AgentToml
        Write-Host "[OK] Created initial config/agent.toml from template" -ForegroundColor Green
    }
} else {
    Write-Host "[OK] Existing config/agent.toml found" -ForegroundColor Yellow
}

# 3. Create required directories
@("$ProjectDir\data", "$ProjectDir\logs", "$ProjectDir\data\backups", "$ProjectDir\data\staging") | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
    }
}
Write-Host "[OK] Data and Log directories ready" -ForegroundColor Green

# 4. Generate Native Messaging Manifest
$ManifestJson = "$ProjectDir\config\driver_update_assistant.json"
$ManifestContent = @{
    name = "driver_update_assistant"
    description = "Native Messaging Host for Delivery Assistant Extension"
    path = $HostPath
    type = "stdio"
    allowed_origins = @(
        "chrome-extension://ajbnjogoeehfjnjbpodgoihmcmooliom/"
    )
} | ConvertTo-Json -Depth 3

[System.IO.File]::WriteAllText($ManifestJson, $ManifestContent, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[OK] Native Host manifest generated pointing to: $HostPath" -ForegroundColor Green

# 5. Register in Windows Registry (HKCU)
$RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\driver_update_assistant"
if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
}
Set-ItemProperty -Path $RegPath -Name "(default)" -Value $ManifestJson
Write-Host "[OK] Registered in Windows Registry: $RegPath" -ForegroundColor Green

Write-Host "`nInstallation Complete! Host executable: $HostPath`n" -ForegroundColor Cyan
