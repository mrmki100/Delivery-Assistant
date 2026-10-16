# PowerShell Verification Script for Delivery Assistant Update Agent
[CmdletBinding()]
param()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = (Resolve-Path "$ScriptDir\..").Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Verifying Delivery Assistant Subsystem Installation    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$Checks = @()

# Check 1: Python
$PyOk = $false
try {
    $PyOut = python --version 2>&1
    if ($LASTEXITCODE -eq 0) { $PyOk = $true }
} catch {}
$Checks += [PSCustomObject]@{ Check = "Python Runtime"; Status = if ($PyOk) { "PASS" } else { "FAIL" }; Details = $PyOut }

# Check 2: Config file
$ConfigOk = Test-Path "$ProjectDir\config\agent.toml"
$Checks += [PSCustomObject]@{ Check = "Agent Configuration"; Status = if ($ConfigOk) { "PASS" } else { "WARN (Template Only)" }; Details = "$ProjectDir\config\agent.toml" }

# Check 3: Native Messaging Registry Key
$RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\driver_update_assistant"
$RegOk = Test-Path $RegPath
$RegVal = ""
if ($RegOk) {
    $RegVal = (Get-ItemProperty -Path $RegPath -Name "(default)" -ErrorAction SilentlyContinue)."(default)"
}
$Checks += [PSCustomObject]@{ Check = "Chrome Native Host Registry"; Status = if ($RegOk) { "PASS" } else { "FAIL" }; Details = $RegVal }

# Check 4: Extension Root
$ExtRoot = (Resolve-Path "$ProjectDir\..").Path
$ExtManifest = Test-Path "$ExtRoot\manifest.json"
$Checks += [PSCustomObject]@{ Check = "Delivery Assistant Extension"; Status = if ($ExtManifest) { "PASS" } else { "FAIL" }; Details = "$ExtRoot\manifest.json" }

# Display Results
$Checks | Format-Table -AutoSize
Write-Host "Verification complete.`n" -ForegroundColor Cyan
