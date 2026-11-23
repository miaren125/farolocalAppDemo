#!/usr/bin/env bash
# Genera FaroLocal.zip con el proyecto listo para entregar.
# Excluye: .git, .claude, __pycache__, *.pyc, bases de datos (*.db: se crean con db.py) y zips anteriores.
# Uso:  bash entregar.sh        (funciona en Linux, macOS y Git Bash de Windows; solo necesita Python)
set -euo pipefail
cd "$(dirname "$0")"

PY=python3
command -v "$PY" >/dev/null 2>&1 && "$PY" -c "" 2>/dev/null || PY=python

"$PY" - <<'PYEOF'
import os, sys, zipfile

RAIZ = "FaroLocal"            # carpeta que aparece al descomprimir
SALIDA = "FaroLocal.zip"
EXCLUIR_DIRS = {".git", ".claude", "__pycache__", ".pytest_cache", "node_modules"}
EXCLUIR_EXT = (".pyc", ".pyo", ".db", ".db-journal", ".zip")

if os.path.exists(SALIDA):
    os.remove(SALIDA)
n = 0
with zipfile.ZipFile(SALIDA, "w", zipfile.ZIP_DEFLATED) as z:
    for carpeta, dirs, archivos in os.walk("."):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUIR_DIRS)
        for a in sorted(archivos):
            if a.endswith(EXCLUIR_EXT):
                continue
            ruta = os.path.join(carpeta, a)
            z.write(ruta, os.path.join(RAIZ, os.path.relpath(ruta, ".")))
            n += 1
print(f"Listo: {SALIDA} ({n} archivos, {os.path.getsize(SALIDA) // 1024} KB)")
PYEOF
