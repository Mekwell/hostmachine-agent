#!/bin/bash
set -e

# HostMachine Minecraft Entrypoint
echo ">>> Initializing Minecraft Grid Module..."
echo ">>> Type: ${TYPE:-PAPER}"
echo ">>> Version: ${VERSION:-LATEST}"

# The itzg image uses its own entrypoint logic, 
# we just need to ensure the environment is ready.
# Persistence is handled by the Docker volume /data

# Start the actual itzg entrypoint
exec /start
