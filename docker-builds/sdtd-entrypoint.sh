#!/bin/bash
# HostMachine 7 Days to Die Core Entrypoint
set -e

echo ">>> Synchronizing 7 Days to Die via SteamCMD..."
/home/steam/steamcmd/steamcmd.sh +force_install_dir /data +login anonymous +app_update 294420 validate +quit

cd /data
BINARY="./7DaysToDieServer.x86_64"

if [ ! -f "$BINARY" ]; then
    echo "!!! CRITICAL: 7 Days to Die binary not found after sync !!!"
    exit 1
fi

S_NAME=${SERVER_NAME:-"HostMachine 7D2D"}
W_SIZE=${WORLD_SIZE:-"4096"}
G_MODE=${GAME_MODE:-"GameModeSurvival"}
DIFF=${DIFFICULTY:-"2"}

echo ">>> Starting 7 Days to Die ($S_NAME)..."
# Note: 7D2D typically uses a serverconfig.xml. 
# We could generate it here based on ENV vars or pass them as CLI args if supported.
# For now, we use standard CLI args pattern.
exec "$BINARY" -configfile=serverconfig.xml -logfile /dev/stdout -quit -batchmode -nographics \
    -servername="$S_NAME" \
    -worldsize="$W_SIZE" \
    -gamemode="$G_MODE" \
    -difficulty="$DIFF"
