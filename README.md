# MeshCentral OmniOS Send Logs Plugin

Plugin for sending OmniOS server logs to the server via the `export_data --mode server` command.

## Description

The plugin adds a "Send logs to server" button on the General tab in MeshCentral, which:
- Calls the console command `export_data --mode server` from the `/home/user/launchpad` directory
- Shows the execution status (in progress, success, error)
- Notifies the user of the result

## Features

- **Log Send Button**: Placed after the Apps plugin (MeshCentral-OmniOSVersion)
- **Visual Status**: Shows the command execution state
- **Timeouts**: Command executes with a 60-second timeout
- **Security**: Command executes in the correct directory
- **Caching**: Status caching on server and client

## Installation

1. Copy the `MeshCentral-OmniOSSendLogs` folder to the MeshCentral plugins directory:
   ```bash
   cp -r MeshCentral-OmniOSSendLogs /path/to/meshcentral/plugins/
   ```

2. The structure should be:
   ```
   plugins/
   └── MeshCentral-OmniOSSendLogs/
       ├── config.json
       ├── omniossendlogs.js (server-side)
       ├── omnioswebclient-sendlogs.js (web client)
       ├── modules_meshcore/
       │   └── omniossendlogs.js (agent-side)
       └── README.md
   ```

3. Restart MeshCentral to load the plugin:
   ```bash
   systemctl restart meshcentral
   ```

## Usage

1. Open a device on the "My Devices" page
2. Go to the General tab
3. Click the "Send logs to server" button
4. Wait for the operation to complete (usually a few seconds)
5. A message with the result will appear

## Requirements

- OmniOS with the `export_data` command installed
- The directory `/home/user/launchpad` must exist and contain `export_data`
- The MeshCentral agent must have permissions to execute the command

## Behavior

### Successful Execution
- The `export_data --mode server` command executed successfully
- User sees a "Logs sent successfully" web-notification in the MeshCentral interface
- The button temporarily turns green

### Error
- The command failed or returned an error
- User sees an error message
- The button turns red
- Retry is possible

## Logging

With debug mode enabled in MeshCentral:
- Agent writes logs with the prefix `[omniossendlogs-agent]`
- Server writes logs with the prefix `[omniossendlogs]`
- Web client writes logs to the browser console

## Support

- Source code: https://github.com/Native-Robotics/MeshCentral-OmniOSSendLogs
- Issues: Use thumbs down in the MeshCentral interface to send feedback

## License

MIT (see LICENSE)

## Changelog

### v1.0.0 - Initial Release
- Added log send button
- Execution status support
- Integration with MeshCentral