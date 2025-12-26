#!/bin/bash
# HostMachine Valheim Core Entrypoint
export HOME=/home/steam
export LD_LIBRARY_PATH=/home/steam/steamcmd/linux64:$LD_LIBRARY_PATH

echo ">>> Synchronizing Valheim via SteamCMD..."
/home/steam/steamcmd/steamcmd.sh +@sSteamCmdForcePlatformType linux +@NoPromptForPassword 1 +login anonymous +force_install_dir /data +app_update 896660 validate +quit

# Defensive defaults
S_NAME=${SERVER_NAME:-"HostMachine Valheim"}
W_NAME=${WORLD_NAME:-"Dedicated"}
S_PASS=${PASSWORD:-""}

if [ ! -f /data/valheim_server.x86_64 ]; then
    echo "!!! CRITICAL: Valheim binary not found after sync !!!"
    # Try a second time without validate if it failed
    /home/steam/steamcmd/steamcmd.sh +@sSteamCmdForcePlatformType linux +@NoPromptForPassword 1 +force_install_dir /data +login anonymous +app_update 896660 +quit
fi

if [ ! -f /data/valheim_server.x86_64 ]; then
    echo "!!! CRITICAL: Valheim binary STILL not found after second attempt. Exiting. !!!"
    exit 1
fi

# Valheim REQUIRES a password of 5+ characters. 
# We'll default to 'hostmachine' if empty to prevent engine crash.
if [ ${#S_PASS} -lt 5 ]; then
    S_PASS="hostmachine"
    echo ">>> INFO: Valheim requires 5+ chars. Defaulting to: hostmachine"
fi

echo ">>> Starting Valheim Server: $S_NAME..."
exec /data/valheim_server.x86_64 -name "$S_NAME" -port 2456 -world "$W_NAME" -password "$S_PASS" -public 1