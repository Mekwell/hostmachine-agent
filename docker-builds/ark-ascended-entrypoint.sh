#!/bin/bash
/home/steam/steamcmd/steamcmd.sh +force_install_dir /data +login anonymous +app_update 2430930 validate +quit
cd /data/ShooterGame/Binaries/Linux

# Defensive defaults
S_NAME=${SERVER_NAME:-"HostMachine ASA"}
S_PASS=${PASSWORD:-""}
A_PASS=${ADMIN_PASSWORD:-"adminsecret"}

QUERY_STR="TheIsland_WP?listen?SessionName=${S_NAME}"
if [ -n "$S_PASS" ]; then
    QUERY_STR="${QUERY_STR}?ServerPassword=${S_PASS}"
fi
QUERY_STR="${QUERY_STR}?ServerAdminPassword=${A_PASS}"

echo ">>> Starting ARK: Ascended ($S_NAME)..."
exec ./ArkAscendedServer "$QUERY_STR" -server -log -Port=7777 -QueryPort=27015
