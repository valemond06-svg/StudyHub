<#
  Installa (o aggiorna) StudyHub su questo PC. Windows 10/11.
  Si può rilanciare quando vuoi: aggiorna librerie e collegamento senza toccare i tuoi dati.

  Uso:   powershell -ExecutionPolicy Bypass -File installa.ps1 -Anno 2
         -Anno            anno di corso attuale (1, 2, 3...): serve a classificare i corsi Moodle
         -Cartella        dove salvare i corsi (default: la cartella che contiene _StudyHub)
         -NoCollegamento  non creare l'icona sul desktop
#>
param([int]$Anno = 0, [string]$Cartella = "", [switch]$NoCollegamento)
$ErrorActionPreference = "Stop"
$App = Split-Path -Parent $MyInvocation.MyCommand.Path
$Local = Join-Path $env:USERPROFILE ".studyhub"
$Venv = Join-Path $Local "venv"
$Py = Join-Path $Venv "Scripts\python.exe"
function Passo($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Controlla($what) { if ($LASTEXITCODE -ne 0) { throw "$what non riuscito (codice $LASTEXITCODE)" } }

Passo "uv (installa e gestisce Python)"
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) {
  $uv = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
  if (-not (Test-Path $uv)) {
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    Controlla "Installazione di uv"
  }
}
if (-not (Test-Path $uv)) { throw "uv non trovato dopo l'installazione: riapri PowerShell e rilancia lo script." }
$env:Path = (Split-Path $uv) + ";" + $env:Path

Passo "Python e librerie (la prima volta qualche minuto: scarica circa 3 GB)"
$env:UV_PROJECT_ENVIRONMENT = $Venv
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Local "ms-playwright"
$env:PYTHONUTF8 = "1"
Push-Location (Join-Path $App "backend")
try { & $uv sync; Controlla "uv sync" } finally { Pop-Location }

Passo "Browser per il login UniVR (Chromium di Playwright)"
& $Py -m playwright install chromium
Controlla "Installazione di Chromium"

Passo "Impostazioni (config.yaml)"
$cfg = @()
if ($Anno -gt 0) { $cfg += @("--anno", "$Anno") }
if ($Cartella) { $cfg += @("--cartella", $Cartella) }
if ($cfg.Count -gt 0 -or -not (Test-Path (Join-Path $App "config.yaml"))) {
  & $Py -m studyhub.cli configura @cfg
  Controlla "Salvataggio delle impostazioni"
}

if (-not $NoCollegamento) {
  Passo "Collegamento sul desktop"
  $desk = [Environment]::GetFolderPath("Desktop")
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk "StudyHub.lnk"))
  $lnk.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
  $lnk.Arguments = '"' + (Join-Path $App "apri_studyhub.vbs") + '"'
  $lnk.WorkingDirectory = $App
  $lnk.IconLocation = Join-Path $App "backend\src\studyhub\api\static\studyhub.ico"
  $lnk.Description = "StudyHub: studio dei corsi UniVR"
  $lnk.Save()
  Write-Host "Creato $desk\StudyHub.lnk"
}

Passo "Collegamento con Claude (server MCP 'studyhub')"
$mcp = [ordered]@{ mcpServers = [ordered]@{ studyhub = [ordered]@{ command = $Py; args = @("-m", "studyhub.mcp_server"); env = @{ PYTHONUTF8 = "1" } } } }
[IO.File]::WriteAllText((Join-Path $App "claude_desktop_mcp.json"), ($mcp | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude -and (Test-Path "$env:USERPROFILE\.local\bin\claude.exe")) { $claude = "$env:USERPROFILE\.local\bin\claude.exe" }
if ($claude) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  & $claude mcp get studyhub *> $null
  if ($LASTEXITCODE -ne 0) { & $claude mcp add --scope user studyhub -e PYTHONUTF8=1 -- $Py -m studyhub.mcp_server }
  else { Write-Host "Già registrato in Claude Code." }
  $ErrorActionPreference = $prev
} else {
  Write-Host "Claude Code non trovato: per Claude Desktop copia il contenuto di claude_desktop_mcp.json nella sua configurazione."
}

Passo "Ricerca per significato (Ollama, facoltativo)"
$ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if ($ollama) { & $ollama pull bge-m3 }
else { Write-Host "Ollama non installato: la ricerca funziona per parole. Per aggiungerla: winget install Ollama.Ollama, poi rilancia questo script." }

Passo "Controllo finale"
& $Py -m studyhub.cli doctor
Write-Host "`nFatto. Apri StudyHub dall'icona sul desktop: la sezione Studia ti guida nel login e nel primo download." -ForegroundColor Green
