@echo off
REM Build and launch Article Image Studio (WPF + WebView2).
setlocal
cd /d "%~dp0"

where dotnet >nul 2>nul
if errorlevel 1 ( echo [!] The .NET SDK is required ^(dotnet^). Install from https://dotnet.microsoft.com & pause & exit /b 1 )

echo [*] Building...
dotnet build -c Release
if errorlevel 1 ( echo [!] Build failed. & pause & exit /b 1 )

echo [*] Launching...
start "" "bin\Release\net8.0-windows\ImageStudio.exe"
endlocal
