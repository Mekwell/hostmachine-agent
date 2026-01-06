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
export WINEPREFIX=/data/.wine
export WINEARCH=win64
export WINEDEBUG=-all
export WINEDLLOVERRIDES="mscoree,mshtml="
export DISPLAY=:99

# Ensure WINEPREFIX directory exists and has correct permissions
mkdir -p "$WINEPREFIX"

# --- REMEDIATION SCRIPT ---
# Check if Wine is actually working. If kernel32.dll fails to load, the prefix is trash.
if [ -f "$WINEPREFIX/system.reg" ]; then
    echo ">>> Validating existing Wine prefix at $WINEPREFIX..."
    # Use a quick wine command to check health
    xvfb-run wine --version > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "!!! CRITICAL: Wine prefix appears broken (kernel32.dll error). WIPING..."
        rm -rf "$WINEPREFIX"
        rm -f "$WINEPREFIX/vcrun2022_installed"
        mkdir -p "$WINEPREFIX"
    fi
fi

echo ">>> Configuring Wine prefix..."

# Cleanup old Xvfb locks
rm -f /tmp/.X99-lock

if [ ! -f "$WINEPREFIX/vcrun2022_installed" ]; then
    echo ">>> First boot: Installing Visual C++ 2022 Runtime into persistent volume..."
    # Start Xvfb in background
    Xvfb :99 -screen 0 1024x768x16 &
    XVFB_PID=$!
    sleep 2
    
    # Initialize prefix first
    wineboot --init
    # Wait for wineboot to finish
    sleep 5
    
    # Install VC++ 2022
    winetricks -q -f vcrun2022
    
    # Kill Xvfb
    kill $XVFB_PID
    rm -f /tmp/.X99-lock
    
    touch "$WINEPREFIX/vcrun2022_installed"
    echo ">>> Visual C++ 2022 installed and persisted."
else
    echo ">>> Visual C++ 2022 already found in persistent volume."
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
