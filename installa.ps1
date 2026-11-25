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

function Aggiorna-Frontend {
  Push-Location $Frontend
  try {
    $inputs = @(
      Get-Item -LiteralPath "package-lock.json", "package.json", "index.html", "vite.config.ts"
      Get-ChildItem -LiteralPath "." -Filter "tsconfig*.json" -File
      Get-ChildItem -LiteralPath "src", "public" -Recurse -File -Force
    )
    $manifest = ($inputs | Sort-Object FullName | ForEach-Object {
      $relative = $_.FullName.Substring($Frontend.Length + 1)
      "$relative $((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
    }) -join "`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $fingerprint = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifest))).Replace("-", "")
    } finally { $sha.Dispose() }
    $index = "dist\index.html"
    $marker = "dist\.studyhub-build"
    if ((Test-Path -LiteralPath $index -PathType Leaf) -and
        (Test-Path -LiteralPath $marker -PathType Leaf) -and
        (([string](Get-Content -LiteralPath $marker -Raw)).Trim() -eq $fingerprint)) {
      Write-Host "Frontend gia aggiornato."
      return
    }

    Write-Host "Build del frontend assente o da aggiornare."
    if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker }
    & $npm ci --include=dev
    Controlla "npm ci"
    & $npm run build
    Controlla "npm run build"
    if (-not (Test-Path -LiteralPath $index -PathType Leaf)) { throw "Build incompleta: manca studyhub-frontend/dist/index.html." }
    Set-Content -LiteralPath $marker -Value $fingerprint -Encoding ASCII
    Write-Host "Frontend compilato in studyhub-frontend/dist."
  } finally { Pop-Location }
}

Passo "Requisiti frontend (Node.js e npm)"
$Frontend = Join-Path $App "studyhub-frontend"
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $node -or -not $npm) {
  throw "Node.js o npm assente. Installa Node.js da https://nodejs.org/ e riapri PowerShell."
}
$nodeVersion = & $node --version
Controlla "Verifica di Node.js"
$version = [version]($nodeVersion.TrimStart("v"))
if (($version.Major -ne 20 -or $version.Minor -lt 19) -and $version -lt [version]"22.12") {
  throw "Node.js $nodeVersion non supportato da Vite. Serve Node.js 20.19+ della serie 20 oppure 22.12+. Scaricalo da https://nodejs.org/."
}
Write-Host "Node.js $nodeVersion"

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

Passo "Frontend React"
Aggiorna-Frontend

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
  # argomenti in un array: PowerShell 5.1 altrimenti si mangia il "--"
  $add = @("mcp", "add", "--scope", "user", "studyhub", "-e", "PYTHONUTF8=1", "--", $Py, "-m", "studyhub.mcp_server")
  if ($LASTEXITCODE -ne 0) { & $claude @add }
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
Controlla "Diagnostica di StudyHub"
if ($NoCollegamento) {
  Write-Host "`nInstallazione aggiornata. Avvia StudyHub con start.bat." -ForegroundColor Green
} else {
  Write-Host "`nInstallazione aggiornata. Apri StudyHub dall'icona sul desktop." -ForegroundColor Green
}
