#!/bin/bash

# Service name
SERVICE_NAME="foxyswitch-api"

# Colors for terminal
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
RED='\033[1;31m'
RESET='\033[0m' # Reset colors

# Emojis
CHECK_MARK="✅"
CROSS_MARK="❌"
BUILD_EMOJI="🛠️"
LIGHTBULB="💡"
PACKAGE="📦"
GEAR="⚙️ "
SPARKLE="✨"

# Automatically determine the path to Node.js
NODE_PATH=$(which node)

# Check if Node.js is installed
if [ -z "$NODE_PATH" ]; then
    echo -e "${RED}${CROSS_MARK} Node.js not found. Please make sure Node.js is installed.${RESET}"
    exit 1
fi

# Path to NPM
NPM_PATH=$(which npm)

# Check if npm is installed
if [ -z "$NPM_PATH" ]; then
    echo -e "${RED}${CROSS_MARK} npm not found. Please make sure npm is installed.${RESET}"
    exit 1
fi

# Working directory — current directory
WORKING_DIRECTORY=$(pwd)

# User name
USER=$(whoami)

# Check if service already exists
if sudo systemctl list-units --full -all | grep -Fq "$SERVICE_NAME.service"; then
    echo -e "${YELLOW}${LIGHTBULB} Service ${SERVICE_NAME} is already installed.${RESET}"
    exit 0
fi

# Install npm dependencies
echo -e "${YELLOW}${PACKAGE} Installing npm dependencies...${RESET}"
$NPM_PATH install
echo -e "${GREEN}${CHECK_MARK} npm dependencies installed successfully.${RESET}"

# Run configuration script
echo -e "${CYAN}${GEAR} Running configuration script...${RESET}"
$NPM_PATH run configure

# Build the TypeScript project
echo -e "${BUILD_EMOJI} Building the TypeScript project...${RESET}"
$NPM_PATH run build
echo -e "${GREEN}${CHECK_MARK} Project built successfully.${RESET}"

# Create the service file
echo -e "${GEAR} Creating service file for $SERVICE_NAME...${RESET}"

sudo bash -c "cat > /etc/systemd/system/$SERVICE_NAME.service << EOL
[Unit]
Description=Foxy Switch API Service
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$WORKING_DIRECTORY
ExecStart=$NPM_PATH start
Restart=always
RestartSec=10
User=$USER
Environment=PATH=$(dirname $NODE_PATH):/usr/bin:/usr/local/bin
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL"

# Reload systemd to update the configuration
echo -e "${GEAR} Reloading systemd daemon...${RESET}"
sudo systemctl daemon-reload
echo -e "${GREEN}${CHECK_MARK} Systemd daemon reloaded.${RESET}"

# Enable the service to start on boot
echo -e "${SPARKLE} Enabling $SERVICE_NAME service to start on boot...${RESET}"
sudo systemctl enable $SERVICE_NAME
echo -e "${GREEN}${CHECK_MARK} $SERVICE_NAME service enabled to start on boot.${RESET}"

# Start the service
echo -e "${GEAR} Starting $SERVICE_NAME service...${RESET}"
sudo systemctl start $SERVICE_NAME
echo -e "${GREEN}${CHECK_MARK} $SERVICE_NAME service started successfully.${RESET}"

echo -e "${GREEN}${SPARKLE} Foxy Switch API has been installed and started!${RESET}"
