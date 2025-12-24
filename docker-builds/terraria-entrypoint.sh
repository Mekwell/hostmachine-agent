#!/bin/bash
if [ ! -f TerrariaServer.exe ]; then
    echo ">>> Downloading Terraria 1.4.4.9..."
    wget -O terraria.zip https://terraria.org/api/download/pc-dedicated-server/terraria-server-1449.zip
    unzip terraria.zip
    cp -r 1449/Linux/* .
    rm -rf 1449 terraria.zip
    chmod +x TerrariaServer.bin.x86_64
fi

# Defensive variable handling
# If MAX_PLAYERS is empty or not a number, default to 16
if [[ ! $MAX_PLAYERS =~ ^[0-9]+$ ]]; then
    MAX_PLAYERS=16
fi

# Always use 7777 internally for the container mapping
echo ">>> Starting Terraria Server (Internal Port: 7777, Players: $MAX_PLAYERS)..."
exec ./TerrariaServer.bin.x86_64 -port 7777 -players "$MAX_PLAYERS" -world /data/worlds/world.wld -autocreate 3