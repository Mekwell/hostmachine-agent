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
SERVER_PASSWORD=${SERVER_PASSWORD:-""}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-"admin123"}
MAX_PLAYERS=${MAX_PLAYERS:-70}
GAME_PORT=${SERVER_PORT:-7777}
QUERY_PORT=${QUERY_PORT:-27015}
RCON_PORT=${RCON_PORT:-27020}

# Construct Launch Arguments
LAUNCH_ARGS="$MAP?listen?SessionName=$SERVER_NAME?ServerAdminPassword=$ADMIN_PASSWORD?Port=$GAME_PORT?QueryPort=$QUERY_PORT?RCONPort=$RCON_PORT?RCONEnabled=True"

if [ -n "$SERVER_PASSWORD" ]; then
    LAUNCH_ARGS="$LAUNCH_ARGS?ServerPassword=$SERVER_PASSWORD"
fi

# Launch using wine via Xvfb
echo ">>> Starting ARK: Ascended (HostMachine ASA) via Wine Staging + Xvfb..."

# CLEANUP STALE PROCESSES (Prevent Socket/Lock errors)
pkill -9 Xvfb > /dev/null 2>&1
pkill -9 ArkAscendedServ > /dev/null 2>&1

# Configure Wine environment
export WINEPREFIX=/data/.wine
export WINEARCH=win64
export WINEDEBUG=-all
export WINEDLLOVERRIDES="mscoree,mshtml="
export DISPLAY=:99
export XDG_RUNTIME_DIR=/tmp/runtime-steam
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# PERFORMANCE OPTIMIZATIONS
export WINEESYNC=1
export WINEFSYNC=1
export WINELoader=1
export WINE_LARGE_ADDRESS_AWARE=1

# Ensure WINEPREFIX directory exists and has correct permissions
mkdir -p "$WINEPREFIX"

# --- REMEDIATION SCRIPT ---
# Check if Wine is actually working. If kernel32.dll fails to load, the prefix is trash.
if [ -f "$WINEPREFIX/system.reg" ]; then
    echo ">>> Validating existing Wine prefix at $WINEPREFIX..."
    # Use wine --version WITHOUT Xvfb first. It should work headless for version check.
    # If it fails, the prefix is truly broken (not just an Xvfb issue).
    wine --version > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "!!! CRITICAL: Wine prefix appears broken (kernel32.dll error). WIPING..."
        rm -rf "$WINEPREFIX"
        rm -f "$WINEPREFIX/vcrun2022_installed"
        mkdir -p "$WINEPREFIX"
    fi
fi

echo ">>> Configuring Wine prefix..."

if [ ! -f "$WINEPREFIX/vcrun2022_installed" ]; then
    echo ">>> First boot: Installing Visual C++ 2022 Runtime into persistent volume..."
    
    # Initialize prefix first using xvfb-run to avoid conflict
    xvfb-run -a wineboot --init
    # Wait for wineboot to finish
    sleep 5
    
    # Install VC++ 2022 using xvfb-run
    xvfb-run -a winetricks -q -f vcrun2022
    
    touch "$WINEPREFIX/vcrun2022_installed"
    echo ">>> Visual C++ 2022 installed and persisted."
else
    echo ">>> Visual C++ 2022 already found in persistent volume."
fi

# Final launch with Xvfb wrapper
xvfb-run --auto-servernum --server-args='-screen 0 1024x768x16' \
/usr/bin/env WINEDEBUG=-all /opt/wine-staging/bin/wine "$BIN_PATH" "$LAUNCH_ARGS" \
    -WinLiveMaxPlayers=$MAX_PLAYERS \
    -NoBattlEye \
    -server \
    -log \
    -nowindow \
    -noxvfb \
    -port=$GAME_PORT
