@echo off
rem Aggiorna StudyHub all'ultima versione (git pull) e ricontrolla l'installazione. I tuoi dati non vengono toccati.
cd /d "%~dp0"
git pull --ff-only || (echo Aggiornamento non riuscito: hai modificato dei file del programma? & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1" -NoCollegamento
pause
