#!/bin/sh
set -e

# Default values
RUN_WEB_GUI="${RUN_WEB_GUI:-false}"
WEB_PORT="${WEB_PORT:-3000}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8978}"

echo "[entrypoint] Starting SchröDrive..."
echo "[entrypoint] RUN_WEB_GUI=${RUN_WEB_GUI}"

# If RUN_WEB_GUI is enabled, start both backend and web GUI
if [ "$RUN_WEB_GUI" = "true" ] || [ "$RUN_WEB_GUI" = "1" ]; then
    echo "[entrypoint] Starting backend and web GUI..."
    
    # Start backend in background
    node /app/dist/index.js "$@" &
    BACKEND_PID=$!
    
    # Wait a moment for backend to start
    sleep 2
    
    # Start Next.js web GUI
    cd /app/web
    export PORT="$WEB_PORT"
    export BACKEND_URL="$BACKEND_URL"
    echo "[entrypoint] Starting web GUI on port ${WEB_PORT}..."
    node_modules/.bin/next start -p "$WEB_PORT" &
    WEB_PID=$!
    
    # Handle shutdown
    trap "kill $BACKEND_PID $WEB_PID 2>/dev/null" EXIT INT TERM
    
    # Wait for either process to exit
    wait $BACKEND_PID $WEB_PID
else
    # Just run the backend
    echo "[entrypoint] Starting backend only..."
    exec node /app/dist/index.js "$@"
fi
