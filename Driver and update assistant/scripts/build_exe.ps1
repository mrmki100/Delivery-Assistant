# PowerShell Build Script for compiling Standalone Windows Executable
[CmdletBinding()]
param()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = (Resolve-Path "$ScriptDir\..").Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Building Driver Assistant Standalone Windows Executable " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Check PyInstaller
$PyInstaller = Get-Command pyinstaller -ErrorAction SilentlyContinue
if (-not $PyInstaller) {
    Write-Warning "PyInstaller not found in PATH. Install with: pip install pyinstaller"
    exit 1
}

$EntryPoint = "$ProjectDir\src\driver_update_assistant\cli.py"
$DistDir = "$ProjectDir\build\dist"
$WorkDir = "$ProjectDir\build\work"

Write-Host "[*] Compiling $EntryPoint..."
pyinstaller --onefile `
    --name "driver-assistant" `
    --distpath $DistDir `
    --workpath $WorkDir `
    --paths "$ProjectDir\src" `
    $EntryPoint

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[✓] Build Succeeded! Output: $DistDir\driver-assistant.exe" -ForegroundColor Green
} else {
    Write-Error "`n[✗] Build failed with exit code $LASTEXITCODE"
}
