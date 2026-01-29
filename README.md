# MeshCentral OmniOS Send Logs

Plugin that adds a button to send OmniOS and apps logs to a server by running export_data command on the agent.

## Features

- Displays "Export Logs" link after the Apps section (from OmniOSVersion plugin) on the General tab.
- Executes `/home/user/.local/bin/export_data --mode server` on the agent.
- Shows export status (running/success/error).
- No admin panel or configuration.

## Installation

1. Copy the `MeshCentral-OmniOSSendLogs` folder into the MeshCentral plugins directory.
2. Restart MeshCentral to load the plugin.

## Usage

- Open a device on "My Devices" → General tab.
- Click "Export Logs" link to trigger log export.
- Status updates will show the result of the operation.

## Requirements

- The agent must have `/home/user/.local/bin/export_data` executable available.
- Requires OmniOSVersion plugin for proper positioning (optional, falls back to Hostname if not present).

## Configuration

The command path can be changed in `modules_meshcore/omniossendlogs.js` by modifying the `EXPORT_CMD` constant.

## Support

- Code comments and log messages are in English.
