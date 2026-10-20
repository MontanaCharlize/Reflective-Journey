#!/usr/bin/env sh
# Backup is implemented once in Node, and works on Windows and Linux.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
exec node scripts/database-backup.mjs "$@"
