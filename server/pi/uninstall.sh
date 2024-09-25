#!/bin/bash

# Service name
SERVICE_NAME="foxyswitch-api"

# Check if the script is run as root, if not, re-run with sudo
if [ "$EUID" -ne 0 ]; then
    echo "This script requires superuser privileges. Re-running with sudo..."
    sudo bash "$0" "$@"
    exit 0
fi

# Check if the service is installed
if systemctl list-units --full -all | grep -Fq "$SERVICE_NAME.service"; then
    # Stopping the service
    echo "Stopping $SERVICE_NAME service..."
    systemctl stop $SERVICE_NAME

    # Disabling the service from autostart
    echo "Disabling $SERVICE_NAME service..."
    systemctl disable $SERVICE_NAME

    # Removing the service file
    echo "Removing $SERVICE_NAME service file..."
    rm /etc/systemd/system/$SERVICE_NAME.service

    # Reloading systemd to update the configuration
    echo "Reloading systemd daemon..."
    systemctl daemon-reload

    echo "$SERVICE_NAME has been uninstalled!"
else
    echo "$SERVICE_NAME service is not installed."
fi
