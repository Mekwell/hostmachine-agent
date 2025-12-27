#!/bin/bash
# Fixed ARK: Ascended entrypoint for Debian/Wine
STEAMCMD="/home/steam/steamcmd/steamcmd.sh"

echo ">>> Ensuring SteamCMD is up to date..."
$STEAMCMD +quit

echo ">>> Synchronizing ARK: Ascended via SteamCMD (App 2430930)..."

# Create script file
cat << 'EOF' > /tmp/ark_sync.txt
@sSteamCmdForcePlatformType windows
force_install_dir /data
login anonymous
app_update 2430930 validate
quit
EOF

# Run script
$STEAMCMD +runscript /tmp/ark_sync.txt

BIN_PATH="/data/ShooterGame/Binaries/Win64/ArkAscendedServer.exe"

if [ ! -f "$BIN_PATH" ]; then
    echo "!!! CRITICAL: ARK: Ascended binary NOT FOUND at $BIN_PATH !!!"
    exit 1
fi

echo ">>> ARK: Ascended binary synchronization COMPLETE."
echo ">>> Host Platform: Linux"
echo ">>> Launching via Wine..."

# Basic params
MAP=${MAP:-"TheIsland_WP"}
SERVER_NAME=${SERVER_NAME:-"HostMachine ASA Server"}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-"admin123"}
MAX_PLAYERS=${MAX_PLAYERS:-70}

# Launch using wine64
# We use -noxvfb if the binary doesn't need it, otherwise we wrap in xvfb-run
wine64 "$BIN_PATH" "$MAP?listen?SessionName=$SERVER_NAME?ServerPassword=$ADMIN_PASSWORD?ServerAdminPassword=$ADMIN_PASSWORD" -WinLiveMaxPlayers=$MAX_PLAYERS -NoBattlEye -noxvfb -baseport=7777
