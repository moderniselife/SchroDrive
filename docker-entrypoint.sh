#!/bin/sh
set -e

# Default values
RUN_WEB_GUI="${RUN_WEB_GUI:-false}"
WEB_PORT="${WEB_PORT:-3000}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8978}"

echo "[entrypoint] Starting SchröDrive (Bun runtime)..."
echo "[entrypoint] RUN_WEB_GUI=${RUN_WEB_GUI}"

# Keep settings written by the UI on the persistent configuration mount. A
# legacy /app/.env is migrated once, atomically, without overwriting an
# existing persistent configuration.
CONFIG_DIR="${CONFIG_DIR:-/config}"
PERSISTED_ENV_PATH="${CONFIG_DIR}/.env"
LEGACY_ENV_PATH="/app/.env"
if [ -d "$CONFIG_DIR" ] && [ -w "$CONFIG_DIR" ] && [ -f "$LEGACY_ENV_PATH" ] && [ ! -e "$PERSISTED_ENV_PATH" ]; then
    umask 077
    TEMP_ENV_PATH="${PERSISTED_ENV_PATH}.tmp.$$"
    cp "$LEGACY_ENV_PATH" "$TEMP_ENV_PATH"
    chmod 600 "$TEMP_ENV_PATH"
    mv "$TEMP_ENV_PATH" "$PERSISTED_ENV_PATH"
    echo "[entrypoint] Migrated persisted configuration to ${PERSISTED_ENV_PATH}"
fi

# Bun automatically loads /app/.env before the application starts. Point it at
# the persistent file so settings survive container recreation and remain the
# single source of truth. Keep a legacy copy only while the migration is being
# completed; it is never loaded by the application.
if [ -f "$PERSISTED_ENV_PATH" ]; then
    chmod 600 "$PERSISTED_ENV_PATH" 2>/dev/null || true
    if [ -e "$LEGACY_ENV_PATH" ] && [ ! -L "$LEGACY_ENV_PATH" ]; then
        mv "$LEGACY_ENV_PATH" "${LEGACY_ENV_PATH}.legacy.$$"
    fi
    ln -sfn "$PERSISTED_ENV_PATH" "$LEGACY_ENV_PATH"
fi

# If RUN_WEB_GUI is enabled, start both backend and web GUI
if [ "$RUN_WEB_GUI" = "true" ] || [ "$RUN_WEB_GUI" = "1" ]; then
    echo "[entrypoint] Starting backend and web GUI..."
    
    # Start backend in background
    bun /app/dist/index.js "$@" &
    BACKEND_PID=$!
    
    # Wait a moment for backend to start
    sleep 2
    
    # Start Next.js web GUI
    cd /app/web
    export PORT="$WEB_PORT"
    export BACKEND_URL="$BACKEND_URL"
    echo "[entrypoint] Starting web GUI on port ${WEB_PORT}..."
    bun node_modules/.bin/next start -p "$WEB_PORT" &
    WEB_PID=$!
    
    # Handle shutdown
    trap "kill $BACKEND_PID $WEB_PID 2>/dev/null" EXIT INT TERM
    
    # Wait for either process to exit
    wait $BACKEND_PID $WEB_PID
else
    # Just run the backend
    echo "[entrypoint] Starting backend only..."
    exec bun /app/dist/index.js "$@"
fi
