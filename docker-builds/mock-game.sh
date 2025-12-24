#!/bin/bash
echo "Starting Mock Game Server v1.0..."
sleep 2
echo "Loading assets..."
sleep 2
echo "Server started on port 25565"

PLAYERS=("Steve" "Alex" "Mekwell" "Gamer123" "NoobMaster" "ProPlayer")

while true; do
    SLEEP_TIME=$((1 + RANDOM % 5))
    sleep $SLEEP_TIME

    # Random Event
    EVENT=$((RANDOM % 100))

    if [ $EVENT -lt 10 ]; then
        # Join
        PLAYER=${PLAYERS[$((RANDOM % ${#PLAYERS[@]}))]}
        echo "[Server thread/INFO]: $PLAYER joined the game"
    elif [ $EVENT -lt 20 ]; then
        # Leave
        PLAYER=${PLAYERS[$((RANDOM % ${#PLAYERS[@]}))]}
        echo "[Server thread/INFO]: $PLAYER left the game"
    elif [ $EVENT -lt 22 ]; then
        # Crash
        echo "Error: Segmentation fault (core dumped)"
        exit 139
    elif [ $EVENT -lt 25 ]; then
        # EULA
        echo "[Server thread/WARN]: Failed to load eula.txt"
        echo "[Server thread/INFO]: You need to agree to the EULA in order to run the server. Go to eula.txt for more info."
        exit 1
    else
        # Normal Log
        echo "[Server thread/INFO]: World auto-saving..."
    fi
done
