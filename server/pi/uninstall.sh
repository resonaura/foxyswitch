#!/bin/bash

# Service name
SERVICE_NAME="foxyswitch-api"

# Check if the service is installed
if sudo systemctl list-units --full -all | grep -Fq "$SERVICE_NAME.service"; then
    # Stopping the service
    echo "Stopping $SERVICE_NAME service..."
    sudo systemctl stop $SERVICE_NAME

    # Disabling the service from autostart
    echo "Disabling $SERVICE_NAME service..."
    sudo systemctl disable $SERVICE_NAME

    # Removing the service file
    echo "Removing $SERVICE_NAME service file..."
    sudo rm /etc/systemd/system/$SERVICE_NAME.service

    # Reloading systemd to update the configuration
    echo "Reloading systemd daemon..."
    sudo systemctl daemon-reload

    echo "$SERVICE_NAME has been uninstalled!"
else
    echo "$SERVICE_NAME service is not installed."
fi
