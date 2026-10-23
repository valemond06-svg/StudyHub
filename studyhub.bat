@echo off
rem Avvia la CLI di StudyHub. Venv, browser e cookie stanno in %USERPROFILE%\.studyhub (fuori da Google Drive).
setlocal
set "UV_PROJECT_ENVIRONMENT=%USERPROFILE%\.studyhub\venv"
set "PLAYWRIGHT_BROWSERS_PATH=%USERPROFILE%\.studyhub\ms-playwright"
set "PYTHONUTF8=1"
cd /d "%~dp0backend"
rem Aggiorna le dipendenze; se un altro comando StudyHub è in esecuzione può fallire: si va avanti lo stesso.
set "UV=uv"
where uv >nul 2>&1 || set "UV=%USERPROFILE%\.local\bin\uv.exe"
"%UV%" sync -q >nul 2>&1
rem Non fa nulla se Chromium è già installato.
"%UV_PROJECT_ENVIRONMENT%\Scripts\python.exe" -m playwright install chromium >nul
rem python -m invece di studyhub.exe: l'exe non resta bloccato e uv sync non fallisce.
"%UV_PROJECT_ENVIRONMENT%\Scripts\python.exe" -m studyhub.cli %*
