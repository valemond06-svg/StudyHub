#!/usr/bin/env bash
# Avvia la CLI di StudyHub su Linux. Venv, browser e cookie stanno in ~/.studyhub.
# Tutto l'output del setup va su stderr: stdout resta quello di `studyhub`.
set -euo pipefail

export UV_PROJECT_ENVIRONMENT="${UV_PROJECT_ENVIRONMENT:-$HOME/.studyhub/venv}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.studyhub/ms-playwright}"
export PYTHONUTF8=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/backend"

UV="uv"
if ! command -v uv >/dev/null 2>&1; then
  UV="$HOME/.local/bin/uv"
fi

# Aggiorna le dipendenze; se fallisce si va avanti lo stesso.
"$UV" sync -q >&2 2>&1 || true

PY="$UV_PROJECT_ENVIRONMENT/bin/python"

# Installa Chromium solo se manca per la versione di Playwright installata.
PW_VERSION="$("$PY" -c "import importlib.metadata as m;print(m.version('playwright'))")"
MARKER="$PLAYWRIGHT_BROWSERS_PATH/.installed-$PW_VERSION"
if [ ! -f "$MARKER" ]; then
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

# python -m invece di studyhub: stesso comportamento del .bat.
exec "$PY" -m studyhub.cli "$@"
