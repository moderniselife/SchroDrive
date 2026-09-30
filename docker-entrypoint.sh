#!/bin/sh
set -e

# Default values
RUN_WEB_GUI="${RUN_WEB_GUI:-false}"
WEB_PORT="${WEB_PORT:-3000}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8978}"

echo "[entrypoint] Starting SchröDrive (Bun runtime)..."
echo "[entrypoint] RUN_WEB_GUI=${RUN_WEB_GUI}"

stop_children() {
    kill "$BACKEND_PID" "$WEB_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
}

handle_signal() {
    stop_children
    exit 143
}

child_alive() {
    CHILD_PID="$1"
    [ -d "/proc/$CHILD_PID" ] || return 1
    CHILD_STATE="$(sed -n 's/^[^)]*) \([^ ]*\).*/\1/p' "/proc/$CHILD_PID/stat" 2>/dev/null || true)"
    [ "$CHILD_STATE" != "Z" ]
}

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
    
    trap 'handle_signal' INT TERM

    # Exit when either child exits.  This is deliberately a small supervisor:
    # Docker must observe the container exit so its restart policy can act.
    while child_alive "$BACKEND_PID" && child_alive "$WEB_PID"; do
        sleep 1
    done

    BACKEND_STATUS=0
    WEB_STATUS=0
    # Do not wait for the surviving child before stopping it: that would
    # recreate the original bug by keeping PID 1 alive indefinitely.
    if ! child_alive "$BACKEND_PID"; then
        kill "$WEB_PID" 2>/dev/null || true
    elif ! child_alive "$WEB_PID"; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    wait "$BACKEND_PID" 2>/dev/null || BACKEND_STATUS=$?
    wait "$WEB_PID" 2>/dev/null || WEB_STATUS=$?
    if [ "$BACKEND_STATUS" -ne 0 ]; then
        exit "$BACKEND_STATUS"
    fi
    exit "$WEB_STATUS"
else
    # Just run the backend
    echo "[entrypoint] Starting backend only..."
    exec bun /app/dist/index.js "$@"
fi
