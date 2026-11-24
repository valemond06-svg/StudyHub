@echo off
setlocal
rem Senza argomenti apre l'interfaccia. Con argomenti avvia la CLI.
if "%~1"=="" (
  powershell.exe -ExecutionPolicy Bypass -File "%~dp0StudyHub.ps1"
  exit /b
)

if not defined UV_PROJECT_ENVIRONMENT set "UV_PROJECT_ENVIRONMENT=%USERPROFILE%\.studyhub\venv"
rem Use the browser cache populated by installa.ps1 and StudyHub.ps1.
set "PLAYWRIGHT_BROWSERS_PATH=%USERPROFILE%\.studyhub\ms-playwright"
set "PYTHONUTF8=1"
set "STUDYHUB_PY=%UV_PROJECT_ENVIRONMENT%\Scripts\python.exe"
if not exist "%STUDYHUB_PY%" (
  >&2 echo Ambiente StudyHub assente. Esegui installa.ps1.
  exit /b 1
)

cd /d "%~dp0backend" || exit /b 1
"%STUDYHUB_PY%" -m studyhub.cli %*
exit /b %ERRORLEVEL%
