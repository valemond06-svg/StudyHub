@echo off
rem Apre StudyHub in esecuzione sul PC Fisso (Desktop-vale con RTX 4070 Ti Super)
set "GIGABIT_IP=10.10.10.1"
set "WIFI_IP=192.168.10.89"
set "TAILSCALE_IP=100.83.194.37"

rem 1. Prova prima il cavo diretto Gigabit (1000 Mbps, latenza <0.3ms)
ping -n 1 -w 300 %GIGABIT_IP% >nul 2>&1
if not errorlevel 1 (
    echo [StudyHub] Connesso via CAVO DIRETTO GIGABIT al PC Fisso (http://%GIGABIT_IP%:8765)...
    start "" "http://%GIGABIT_IP%:8765"
    exit /b 0
)

rem 2. Prova la LAN Wi-Fi di casa
ping -n 1 -w 500 %WIFI_IP% >nul 2>&1
if not errorlevel 1 (
    echo [StudyHub] Connesso via LAN Wi-Fi al PC Fisso (http://%WIFI_IP%:8765)...
    start "" "http://%WIFI_IP%:8765"
    exit /b 0
)

rem 3. Prova Tailscale (se fuori casa)
ping -n 1 -w 500 %TAILSCALE_IP% >nul 2>&1
if not errorlevel 1 (
    echo [StudyHub] Connesso via Tailscale al PC Fisso (http://%TAILSCALE_IP%:8765)...
    start "" "http://%TAILSCALE_IP%:8765"
    exit /b 0
)

echo [StudyHub] Nessun link risponde al ping. Tentativo apertura http://%WIFI_IP%:8765...
start "" "http://%WIFI_IP%:8765"
