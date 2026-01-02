#!/bin/bash
# Fixed ARK: Ascended entrypoint for Debian/Wine
STEAMCMD="/home/steam/steamcmd/steamcmd.sh"

echo ">>> Ensuring SteamCMD is up to date..."
rm -rf /home/steam/Steam/appcache /home/steam/Steam/depotcache
$STEAMCMD +quit

BIN_PATH="/data/ShooterGame/Binaries/Win64/ArkAscendedServer.exe"

if [ -f "$BIN_PATH" ] && [ "${ALWAYS_UPDATE}" != "true" ]; then
    echo ">>> ASA Binary found. Skipping SteamCMD sync for faster boot."
else
    echo ">>> Synchronizing ARK: Ascended via SteamCMD (App 2430930)..."
    # Direct execution
    $STEAMCMD +@sSteamCmdForcePlatformType windows +force_install_dir /data +login anonymous +app_update 2430930 validate +quit
fi

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
GAME_PORT=${SERVER_PORT:-7777}
QUERY_PORT=${QUERY_PORT:-27015}
RCON_PORT=${RCON_PORT:-27020}

# Launch using wine via Xvfb
echo ">>> Starting ARK: Ascended (HostMachine ASA) via Wine Staging + Xvfb..."

# Configure Wine environment
export WINEPREFIX=/home/steam/.wine
export WINEARCH=win64
export WINEDEBUG=-all
export WINEDLLOVERRIDES="mscoree,mshtml="
export DISPLAY=:99

echo ">>> Configuring Wine prefix..."

# Cleanup old Xvfb locks
rm -f /tmp/.X99-lock

if [ ! -f "/home/steam/.wine/vcrun2022_installed" ]; then
    echo ">>> First boot: Installing Visual C++ 2022 Runtime..."
    # Start Xvfb in background
    Xvfb :99 -screen 0 1024x768x16 &
    XVFB_PID=$!
    sleep 2
    
    # Initialize prefix first
    wineboot --init
    # Install VC++ 2022
    winetricks -q -f vcrun2022
    
    # Kill Xvfb
    kill $XVFB_PID
    rm -f /tmp/.X99-lock
    
    touch "/home/steam/.wine/vcrun2022_installed"
    echo ">>> Visual C++ 2022 installed."
else
    echo ">>> Visual C++ 2022 already installed."
fi

# Final launch with Xvfb wrapper
xvfb-run --auto-servernum --server-args='-screen 0 1024x768x16' \
/usr/bin/env WINEDEBUG=-all /opt/wine-staging/bin/wine "$BIN_PATH" "$MAP?listen?SessionName=$SERVER_NAME?ServerPassword=$ADMIN_PASSWORD?ServerAdminPassword=$ADMIN_PASSWORD?Port=$GAME_PORT?QueryPort=$QUERY_PORT?RCONPort=$RCON_PORT?RCONEnabled=True" \
    -WinLiveMaxPlayers=$MAX_PLAYERS \
    -NoBattlEye \
    -server \
    -log \
    -nowindow \
    -noxvfb \
    -port=$GAME_PORT
