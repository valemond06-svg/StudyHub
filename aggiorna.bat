@echo off
setlocal
rem Aggiorna StudyHub all'ultima versione (git pull) e ricontrolla l'installazione. I tuoi dati non vengono toccati.
cd /d "%~dp0" || exit /b 1
git pull --ff-only || (echo Aggiornamento non riuscito: hai modificato dei file del programma? & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1"
set "RESULT=%ERRORLEVEL%"
if "%RESULT%"=="0" (
  echo StudyHub aggiornato.
) else (
  >&2 echo Aggiornamento di StudyHub non riuscito ^(codice %RESULT%^).
)
pause
exit /b %RESULT%
