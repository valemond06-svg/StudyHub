#!/usr/bin/env bash
# Usa ./studyhub.sh setup per installare o aggiornare, poi ./studyhub.sh serve.
# Tutto l'output del setup va su stderr: stdout resta quello di `studyhub`.
set -euo pipefail

export UV_PROJECT_ENVIRONMENT="${UV_PROJECT_ENVIRONMENT:-$HOME/.studyhub/venv}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.studyhub/ms-playwright}"
export PYTHONUTF8=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$UV_PROJECT_ENVIRONMENT/bin/python"

check_node() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Node.js o npm assente. Installa Node.js da https://nodejs.org/ e riapri il terminale." >&2
    return 1
  fi
  local version major minor
  version="$(node --version)"
  IFS=. read -r major minor _ <<< "${version#v}"
  if ! (( (major == 20 && minor >= 19) || (major == 22 && minor >= 12) || major > 22 )); then
    echo "Node.js $version non supportato da Vite. Serve Node.js 20.19+ della serie 20 oppure 22.12+. Scaricalo da https://nodejs.org/." >&2
    return 1
  fi
  echo "Node.js $version" >&2
}

build_frontend() (
  cd "$SCRIPT_DIR/studyhub-frontend"
  local fingerprint marker=dist/.studyhub-build
  fingerprint="$(
    find package-lock.json package.json index.html vite.config.ts tsconfig*.json src public -type f -print0 |
      LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
  )"
  if [[ -f dist/index.html && -f "$marker" && "$(< "$marker")" == "$fingerprint" ]]; then
    echo "Frontend gia aggiornato."
    return
  fi

  echo "Build del frontend assente o da aggiornare."
  rm -f -- "$marker"
  npm ci --include=dev
  npm run build
  if [[ ! -f dist/index.html ]]; then
    echo "Build incompleta: manca studyhub-frontend/dist/index.html."
    return 1
  fi
  printf '%s\n' "$fingerprint" > "$marker"
  echo "Frontend compilato in studyhub-frontend/dist."
)

if [[ "${1:-}" == setup ]]; then
  check_node
  UV="$(command -v uv || printf '%s' "$HOME/.local/bin/uv")"
  if [[ ! -x "$UV" ]]; then
    echo "uv assente. Installa uv e rilancia ./studyhub.sh setup." >&2
    exit 1
  fi

  echo "Aggiornamento delle dipendenze Python." >&2
  cd "$SCRIPT_DIR/backend"
  "$UV" sync -q >&2

  # Installa Chromium una volta per versione di Playwright.
  PW_VERSION="$("$PY" -c "import importlib.metadata as m;print(m.version('playwright'))")"
  MARKER="$PLAYWRIGHT_BROWSERS_PATH/.installed-$PW_VERSION"
  if [[ ! -f "$MARKER" ]]; then
    mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
    if sudo -n true 2>/dev/null; then
      "$PY" -m playwright install --with-deps chromium >&2
    else
      echo "studyhub: sudo non disponibile senza password; installo Chromium senza dipendenze di sistema." >&2
      echo "studyhub: se Chromium non parte, lancia a mano: $PY -m playwright install-deps chromium" >&2
      "$PY" -m playwright install chromium >&2
    fi
    touch "$MARKER"
  fi

  build_frontend >&2
  echo "Installazione aggiornata. Avvia StudyHub con ./studyhub.sh serve." >&2
  exit 0
fi

if [[ ! -x "$PY" ]]; then
  echo "Ambiente StudyHub assente. Esegui ./studyhub.sh setup." >&2
  exit 1
fi
if [[ "${1:-}" == serve && ! -f "$SCRIPT_DIR/studyhub-frontend/dist/index.html" ]]; then
  echo "Build del frontend assente. Esegui ./studyhub.sh setup." >&2
fi

cd "$SCRIPT_DIR/backend"
exec "$PY" -m studyhub.cli "$@"
