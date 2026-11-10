@echo off
rem Apre StudyHub in esecuzione sul PC Fisso (Desktop-vale con RTX 4070 Ti Super)
set "DESKTOP_IP=192.168.10.89"
set "TAILSCALE_IP=100.83.194.37"

rem Prova prima l'indirizzo LAN Wi-Fi
ping -n 1 -w 500 %DESKTOP_IP% >nul 2>&1
if not errorlevel 1 (
    echo [StudyHub] Connesso via LAN Wi-Fi al PC Fisso (http://%DESKTOP_IP%:8765)...
    start "" "http://%DESKTOP_IP%:8765"
    exit /b 0
)

rem Prova l'indirizzo Tailscale
ping -n 1 -w 500 %TAILSCALE_IP% >nul 2>&1
if not errorlevel 1 (
    echo [StudyHub] Connesso via Tailscale al PC Fisso (http://%TAILSCALE_IP%:8765)...
    start "" "http://%TAILSCALE_IP%:8765"
    exit /b 0
)

echo [StudyHub] PC Fisso non risponde al ping. Tentativo apertura http://%DESKTOP_IP%:8765...
start "" "http://%DESKTOP_IP%:8765"
