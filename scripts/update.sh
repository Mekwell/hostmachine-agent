#!/bin/bash
# Auto-Update Script for Hostmachine Node Agent
# Run via Cron

APP_DIR="/opt/hostmachine-agent"
LOG_FILE="/var/log/hostmachine-agent-update.log"

# Navigate to App Dir
cd $APP_DIR || exit 1

# Redirect output to log
exec >> $LOG_FILE 2>&1

echo "[$(date)] Checking for updates..."

# Fetch latest
git fetch origin main

# Compare
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "[$(date)] Update found! Pulling..."
    git pull origin main
    
    echo "[$(date)] Installing dependencies..."
    npm install
    
    echo "[$(date)] Building..."
    npm run build
    
    echo "[$(date)] Restarting Agent Service..."
    systemctl restart hostmachine-agent
    
    echo "[$(date)] Update Complete. New version: $REMOTE"
else
    exit 0
fi
