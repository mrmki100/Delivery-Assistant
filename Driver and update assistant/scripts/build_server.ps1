# Build script for DriverUpdateAssistant-Server.exe
# Target: Windows 10/11 x64 Administrator Laptop

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Building Delivery Assistant: Server Management Console    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$PythonExe = "C:\Users\mrmki\AppData\Local\Python\pythoncore-3.14-64\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = "python.exe"
}

$DistDir = Join-Path $ProjectRoot "dist\server"
$BuildDir = Join-Path $ProjectRoot "build\server"

if (Test-Path $DistDir) {
    Remove-Item -Recurse -Force $DistDir
}
if (Test-Path $BuildDir) {
    Remove-Item -Recurse -Force $BuildDir
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

Write-Host "[1/3] Compiling standalone Server executable via PyInstaller..." -ForegroundColor Yellow

$PyInstallerArgs = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--windowed",
    "--name", "DriverUpdateAssistant-Server",
    "--distpath", $DistDir,
    "--workpath", $BuildDir,
    "--paths", (Join-Path $ProjectRoot "src"),
    "--exclude-module", "driver_update_assistant.client.gui",
    (Join-Path $ProjectRoot "src\driver_update_assistant\server\main.py")
)

& $PythonExe $PyInstallerArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "PyInstaller failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "[2/3] Staging default server configuration templates..." -ForegroundColor Yellow
$ConfigDist = Join-Path $DistDir "DriverUpdateAssistant-Server\config"
New-Item -ItemType Directory -Force -Path $ConfigDist | Out-Null
Copy-Item (Join-Path $ProjectRoot "config\server.toml") (Join-Path $ConfigDist "server.toml")

Write-Host "[3/3] Build complete!" -ForegroundColor Green
$ExePath = Join-Path $DistDir "DriverUpdateAssistant-Server\DriverUpdateAssistant-Server.exe"
if (Test-Path $ExePath) {
    $SizeMB = [math]::Round((Get-Item $ExePath).Length / 1MB, 2)
    Write-Host "Executable generated successfully: $ExePath ($SizeMB MB)" -ForegroundColor Green
} else {
    Write-Warning "Executable not found at expected location: $ExePath"
}
