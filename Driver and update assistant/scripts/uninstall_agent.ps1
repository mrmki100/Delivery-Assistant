# PowerShell Agent Uninstallation Script for Delivery Assistant Update Agent
[CmdletBinding()]
param()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = (Resolve-Path "$ScriptDir\..").Path

Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host "  Uninstalling Delivery Assistant Windows Update Agent   " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Yellow

# 1. Unregister Chrome Native Messaging
$RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\driver_update_assistant"
if (Test-Path $RegPath) {
    Remove-Item -Path $RegPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Removed Chrome Native Messaging Registry Key" -ForegroundColor Green
} else {
    Write-Host "[INFO] Native Messaging Registry Key not found" -ForegroundColor Gray
}

# 2. Cleanup Lingering Temporary Shares & Firewall Rules
$SessionFile = "$ProjectDir\data\folder_sessions.json"
if (Test-Path $SessionFile) {
    try {
        $Sessions = Get-Content $SessionFile -Raw | ConvertFrom-Json
        foreach ($prop in $Sessions.PSObject.Properties) {
            $sess = $prop.Value
            if ($sess.share_name) {
                Write-Host "[*] Removing share $($sess.share_name)..."
                net share "$($sess.share_name)" /delete /y 2>$null | Out-Null
            }
            if ($sess.firewall_rule_name) {
                Write-Host "[*] Removing firewall rule $($sess.firewall_rule_name)..."
                netsh advfirewall firewall delete rule name="$($sess.firewall_rule_name)" 2>$null | Out-Null
            }
        }
    } catch {
        Write-Warning "Could not parse folder_sessions.json: $_"
    }
}

# 3. Clean temporary staging / downloads
@("$ProjectDir\data\staging", "$ProjectDir\data\downloads") | ForEach-Object {
    if (Test-Path $_) {
        Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n[OK] Uninstallation Complete. Extension files remain intact." -ForegroundColor Green
