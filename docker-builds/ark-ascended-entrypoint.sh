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
app_set_config 2430930 modbranch public
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

# Launch using wine via Xvfb
echo ">>> Starting ARK: Ascended (HostMachine ASA) via Wine Staging + Xvfb..."

# Configure Wine environment
echo ">>> Configuring Wine prefix..."
winetricks -q win10
# Note: vcrun2022 often helps with missing api-ms-win-core DLLs
# winetricks -q vcrun2022 

xvfb-run --auto-servernum --server-args='-screen 0 1024x768x16' \
/opt/wine-staging/bin/wine "$BIN_PATH" "$MAP?listen?SessionName=$SERVER_NAME?ServerPassword=$ADMIN_PASSWORD?ServerAdminPassword=$ADMIN_PASSWORD" \
    -WinLiveMaxPlayers=$MAX_PLAYERS \
    -NoBattlEye \
    -server \
    -log \
    -noxvfb \
    -baseport=7777
