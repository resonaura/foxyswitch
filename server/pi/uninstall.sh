#!/bin/bash

# Service name
SERVICE_NAME="foxyswitch-api"

# Colors for terminal
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
RESET='\033[0m' # Reset colors

# Emojis
CHECK_MARK="✅"
CROSS_MARK="❌"
GEAR="⚙️ "

# Check if the service is installed
if sudo systemctl list-units --full -all | grep -Fq "$SERVICE_NAME.service"; then
    # Stopping the service
    echo -e "${GEAR} Stopping $SERVICE_NAME service...${RESET}"
    sudo systemctl stop $SERVICE_NAME

    # Disabling the service from autostart
    echo -e "${GEAR} Disabling $SERVICE_NAME service...${RESET}"
    sudo systemctl disable $SERVICE_NAME

    # Removing the service file
    echo -e "${GEAR} Removing $SERVICE_NAME service file...${RESET}"
    sudo rm /etc/systemd/system/$SERVICE_NAME.service

    # Reloading systemd to update the configuration
    echo -e "${GEAR} Reloading systemd daemon...${RESET}"
    sudo systemctl daemon-reload

    echo -e "${GREEN}${CHECK_MARK} $SERVICE_NAME has been uninstalled!${RESET}"
else
    echo -e "${YELLOW}${CROSS_MARK} $SERVICE_NAME service is not installed.${RESET}"
fi
