#!/bin/bash

set -e

TUNNEL_NAME="openclaw-dashboard"
DOMAIN="openclawdashboard.tokopawon.id"
PORT="18789"
USER_CONFIG_DIR="$HOME/.cloudflared"
SYSTEM_CONFIG_DIR="/etc/cloudflared"

echo "=== Cloudflare Tunnel Setup for OpenClaw Dashboard ==="
echo "Domain: $DOMAIN"
echo "Port:   $PORT"
echo ""

# --- Install cloudflared if missing ---
if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared..."
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
    chmod +x /tmp/cloudflared
    sudo mv /tmp/cloudflared /usr/local/bin/
    echo "cloudflared installed."
fi

# --- Login (skip if already authenticated) ---
if [ -f "$USER_CONFIG_DIR/cert.pem" ]; then
    echo "Already logged in to Cloudflare (cert.pem found). Skipping login."
else
    echo "Logging in to Cloudflare (browser will open)..."
    cloudflared tunnel login
fi

# --- Create tunnel (skip if already exists) ---
if cloudflared tunnel list | grep -qw "$TUNNEL_NAME"; then
    echo "Tunnel '$TUNNEL_NAME' already exists. Skipping creation."
else
    echo "Creating tunnel: $TUNNEL_NAME"
    cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID=$(cloudflared tunnel list | grep -w "$TUNNEL_NAME" | awk '{print $1}')
echo "Tunnel ID: $TUNNEL_ID"

# --- Ensure credentials are available for system service ---
sudo mkdir -p "$SYSTEM_CONFIG_DIR"

if [ -f "$USER_CONFIG_DIR/$TUNNEL_ID.json" ]; then
    sudo cp "$USER_CONFIG_DIR/$TUNNEL_ID.json" "$SYSTEM_CONFIG_DIR/$TUNNEL_NAME.json"
elif [ ! -f "$SYSTEM_CONFIG_DIR/$TUNNEL_NAME.json" ]; then
    echo "ERROR: Credentials file not found at $USER_CONFIG_DIR/$TUNNEL_ID.json"
    exit 1
fi

# Also keep a local copy for convenience
cp "$SYSTEM_CONFIG_DIR/$TUNNEL_NAME.json" "$USER_CONFIG_DIR/$TUNNEL_NAME.json" 2>/dev/null || true

# --- Write config for system service ---
CONFIG_FILE="$SYSTEM_CONFIG_DIR/${TUNNEL_NAME}-config.yml"

if [ -f "$CONFIG_FILE" ] && ! grep -q "$TUNNEL_ID" "$CONFIG_FILE"; then
    echo "WARNING: $CONFIG_FILE already exists and references a different tunnel."
    echo "Backing up to ${CONFIG_FILE}.bak"
    sudo cp "$CONFIG_FILE" "${CONFIG_FILE}.bak"
fi

sudo tee "$CONFIG_FILE" > /dev/null << EOF
tunnel: $TUNNEL_ID
credentials-file: $SYSTEM_CONFIG_DIR/$TUNNEL_NAME.json

ingress:
  - hostname: $DOMAIN
    service: http://localhost:$PORT
  - service: http_status:404
EOF
echo "Config written to $CONFIG_FILE"

# --- Create DNS route (skip if already exists) ---
if cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN" 2>&1 | grep -q "already exists"; then
    echo "DNS route for $DOMAIN already exists. Skipping."
else
    # The command was already run by the check above (it created the route if needed).
    # If it was a new route and succeeded, cloudflared doesn't print "already exists",
    # so the route was created.  We re-run it with proper messaging.
    echo "Creating DNS route for $DOMAIN..."
    cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN" 2>/dev/null || true
fi

# --- Install and start systemd service ---
if systemctl is-active --quiet cloudflared 2>/dev/null; then
    echo "cloudflared service already running. Restarting to pick up new config..."
    sudo systemctl restart cloudflared
else
    echo "Installing cloudflared systemd service..."
    sudo cloudflared --config "$CONFIG_FILE" service install
    echo "Starting cloudflared service..."
    sudo systemctl start cloudflared
fi

sudo systemctl enable cloudflared 2>/dev/null || true

echo ""
echo "=== Setup Complete! ==="
echo "Dashboard: https://$DOMAIN"
echo ""
echo "Useful commands:"
echo "  Status:   sudo systemctl status cloudflared"
echo "  Logs:     sudo journalctl -u cloudflared -f"
echo "  Restart:  sudo systemctl restart cloudflared"
echo "  Stop:     sudo systemctl stop cloudflared"
