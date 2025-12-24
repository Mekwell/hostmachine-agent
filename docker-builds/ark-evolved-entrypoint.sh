#!/bin/bash
# HostMachine ARK Evolved Core Entrypoint
export HOME=/home/steam

echo ">>> Synchronizing ARK: Evolved via SteamCMD..."
/home/steam/steamcmd/steamcmd.sh +@sSteamCmdForcePlatformType linux +force_install_dir /data +login anonymous +app_update 376030 validate +quit

cd /data/ShooterGame/Binaries/Linux

if [ ! -f ./ShooterGameServer ]; then
    echo "!!! CRITICAL: ARK binary not found after sync !!!"
    exit 1
fi

# Defensive defaults
S_NAME=${SERVER_NAME:-"HostMachine ARK"}
S_PASS=${PASSWORD:-""}
A_PASS=${ADMIN_PASSWORD:-"adminsecret"}

QUERY_STR="TheIsland?listen?SessionName=${S_NAME}"
if [ -n "$S_PASS" ]; then
    QUERY_STR="${QUERY_STR}?ServerPassword=${S_PASS}"
fi
QUERY_STR="${QUERY_STR}?ServerAdminPassword=${A_PASS}"

echo ">>> Starting ARK: Evolved ($S_NAME)..."
exec ./ShooterGameServer "$QUERY_STR" -server -log -Port=7777 -QueryPort=27015