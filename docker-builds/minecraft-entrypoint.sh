#!/bin/bash
if [ ! -f server.jar ]; then
    echo ">>> Downloading PaperMC LATEST..."
    curl -o server.jar https://api.papermc.io/v2/projects/paper/versions/1.21.1/builds/131/downloads/paper-1.21.1-131.jar
fi
if [ ! -f eula.txt ]; then
    echo "eula=true" > eula.txt
fi

# Defensive variable handling
if [[ ! $MEMORY =~ ^[0-9]+$ ]]; then
    MEMORY=2048
fi

echo ">>> Starting Minecraft Server with ${MEMORY}M RAM..."
exec java -Xms${MEMORY}M -Xmx${MEMORY}M -XX:+UseG1GC -jar server.jar nogui --port 25565