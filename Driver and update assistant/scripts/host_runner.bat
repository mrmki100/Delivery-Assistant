@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."

if exist "%ROOT_DIR%\dist\client\DriverUpdateAssistant-Client\DriverUpdateAssistant-Client.exe" (
    "%ROOT_DIR%\dist\client\DriverUpdateAssistant-Client\DriverUpdateAssistant-Client.exe" --native-host
    exit /b %ERRORLEVEL%
)

set "PYTHONPATH=%ROOT_DIR%\src;%PYTHONPATH%"
python -m driver_update_assistant.native_messaging.host
endlocal
