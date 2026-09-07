# MeshCentral OmniOS Send Logs

Plugin that adds buttons to send OmniOS and apps logs, and OmniOS settings, to a server by running Launchpad's `export_data.py` on the agent.

## Features

- Displays "Export Logs", "Export Trajectories" and "Export Settings" links after the Apps section (from OmniOSVersion plugin) on the General tab.
- "Export Logs" sends the most recent time window the installed Launchpad supports: 30 minutes, falling back to 2 hours, falling back to the last session, on older builds.
- "Export Settings" packages only `OmniPack` and `OmniControl` from `DATA_MOUNT_POINT` (no logs, no other settings folders). Disabled until the agent confirms the installed `export_data.py` actually supports `--settings-only`, so it can never be clicked into a doomed export on an old Launchpad.
- Executes `python3 /home/user/launchpad/pages/data/export_data.py --mode server [args]` on the agent (as user `user`, via `su`).
- Shows export status (running/success/error).
- No admin panel or configuration.

## Installation

1. Copy the `MeshCentral-OmniOSSendLogs` folder into the MeshCentral plugins directory.
2. Restart MeshCentral to load the plugin.

## Usage

- Open a device on "My Devices" → General tab.
- Click "Export Logs" to send the most recent logs (time window depends on what the device's Launchpad supports, see Features).
- Click "Export Trajectories" to include trajectory data.
- Click "Export Settings" (once enabled) to send just the `OmniPack`/`OmniControl` settings folders.
- Status updates will show the result of the operation.

## Requirements

- The agent must have `/home/user/launchpad/pages/data/export_data.py` available and runnable as user `user`.
- `--settings-only` requires a Launchpad build that supports it; the plugin detects this itself and disables "Export Settings" otherwise.
- Requires OmniOSVersion plugin for proper positioning (optional, falls back to Hostname if not present).

## Configuration

The Python interpreter and script path can be changed in `modules_meshcore/omniossendlogs.js` by modifying the `PYTHON_BIN`/`EXPORT_SCRIPT`/`EXPORT_CWD` constants.

## Support

- Code comments and log messages are in English.
