#!/bin/bash
set -e

# ==========================================
# Hostmachine Node Agent Deployment Script
# Target: Ubuntu 24.04 LTS (HP Server)
# Usage: ./deploy-node.sh --token <AGENT_TOKEN> --vpn-key <NETMAKER_KEY>
# ==========================================

TOKEN=""
VPN_KEY=""
CONTROLLER_URL="http://10.10.10.1:3000" # Default to VPN IP (Mesh internal IP)

# Parse Args
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --token) TOKEN="$2"; shift ;;
        --vpn-key) VPN_KEY="$2"; shift ;;
        --controller) CONTROLLER_URL="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$TOKEN" ] || [ -z "$VPN_KEY" ]; then
    echo "Error: Both --token and --vpn-key are required."
    echo "Usage: ./deploy-node.sh --token <AGENT_TOKEN> --vpn-key <NETMAKER_KEY>"
    exit 1
fi

echo ">>> Starting Hostmachine Node Provisioning..."

# Skip problematic commands in test mode
if [ "$HM_TEST_MODE" = "true" ]; then
    echo "--- HM_TEST_MODE enabled. Skipping Docker, ZFS, VPN, and UFW setup ---"
    # Create dummy user for Docker to avoid failure on Docker config step
    sudo useradd -m -s /bin/bash dockremap || true
else
    # 1. System Updates
    echo "--- [1/6] Updating System ---"
    sudo apt-get update
    sudo apt-get install -y curl git zfsutils-linux wireguard-tools apt-transport-https ca-certificates gnupg lsb-release

    # 2. Join Mesh VPN (Netmaker)
    echo "--- [2/6] Joining Mesh Network ---"
    # Check if netclient is installed
    if ! command -v netclient &> /dev/null; then
        echo "Installing Netclient..."
        curl -sL 'https://apt.netmaker.org/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/netmaker-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/netmaker-keyring.gpg] https://apt.netmaker.org debian stable main" | sudo tee /etc/apt/sources.list.d/netmaker.list
        sudo apt-get update
        sudo apt-get install -y netclient
    fi

    echo "Joining Mesh..."
    sudo netclient join -t "$VPN_KEY"
    # Wait for interface to come up (approx 5s)
    sleep 5

    # 3. Install Docker
    echo "--- [3/6] Installing Docker ---"
    if ! command -v docker &> /dev/null; then
        curl -fsSL https://get.docker.com | sudo sh
        sudo usermod -aG docker $USER
    fi

    # 4. Configure Docker User Namespaces (Security)
    echo "--- [4/6] Hardening Docker ---"
    if [ ! -f "/etc/docker/daemon.json" ]; then
        echo "{ \"userns-remap\": \"default\" }" | sudo tee /etc/docker/daemon.json
        sudo systemctl restart docker
    fi

    # 5. Install Node.js
    echo "--- [5/6] Installing Runtime ---"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 6. Deploy Agent
echo "--- [6/6] Deploying Agent ---"
APP_DIR="/opt/hostmachine-agent"

# In production, we would wget a pre-compiled binary here.
# For prototype, we clone and build.
if [ ! -d "$APP_DIR" ]; then
    sudo mkdir -p $APP_DIR
    sudo chown -R root:root $APP_DIR # Use root as owner for system apps
    echo "!!! NOTE: You must upload the 'src/hostmachine-agent' code to $APP_DIR manually for this prototype !!!"
    # echo "Cloning repo..." (Uncomment when you have a private git repo)
fi

# Configure
mkdir -p /etc/hostmachine
cat <<EOF | sudo tee /etc/hostmachine/agent.json
{
  "CONTROLLER_URL": "$CONTROLLER_URL",
  "ENROLLMENT_TOKEN": "$TOKEN",
  "LOG_LEVEL": "info"
}
EOF

# Install Service
cat <<EOF | sudo tee /etc/systemd/system/hostmachine-agent.service
[Unit]
Description=Hostmachine Node Agent
After=network.target docker.service nm-netmaker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/dist/main.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

if [ "$HM_TEST_MODE" != "true" ]; then
    sudo systemctl daemon-reload
    sudo systemctl enable hostmachine-agent
    # sudo systemctl start hostmachine-agent (Start only after code upload)
else
    echo "Skipping systemctl enable/start in test mode."
fi

# 9. Configure Auto-Updates (Cron)
echo "--- Configuring Auto-Updates ---"
UPDATE_SCRIPT="$APP_DIR/scripts/update.sh"
# Ensure scripts dir exists in case code wasn't uploaded yet
mkdir -p "$APP_DIR/scripts"

# We assume the update script will be present after code upload.
# But we can register the cron job now.
if ! crontab -l | grep -q "hostmachine-agent/scripts/update.sh"; then
    echo "Adding Cron Job..."
    # Run as root
    (sudo crontab -l 2>/dev/null; echo "*/5 * * * * $UPDATE_SCRIPT") | sudo crontab -
else
    echo "Cron job already exists."
fi

echo ">>> Node Provisioning Complete!"
echo "Status:"
echo "  - Mesh VPN: Connected (Mocked in test mode)"
echo "  - Docker: Installed & Hardened (Mocked in test mode)"
echo "  - Agent: Configured (Waiting for code)"
