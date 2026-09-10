# MeshCentral OmniOS Send Logs

Plugin that adds buttons to send OmniOS and apps logs, and OmniOS settings, to a server by running Launchpad's `export_data.py` on the agent.

## Features

- Displays "Export Logs", "Export Trajectories" and "Export Settings" links after the Apps section (from OmniOSVersion plugin) on the General tab.
- On Launchpad builds that support an arbitrary log window (`--log-window`), "Export Logs" becomes three explicit links — "Export Logs (last 30 min)", "(last 60 min)", "(last 120 min)" — each sending exactly that window. On older builds it stays a single "Export Logs" link that sends the most recent time window the installed Launchpad supports: 30 minutes, falling back to 2 hours, falling back to the last session.
- "Export Settings" packages only `OmniPack` and `OmniControl` from `DATA_MOUNT_POINT` (no logs, no other settings folders). Disabled until the agent confirms `--settings-only` support. The agent checks support again when executing the operation.
- Executes `python3 /home/user/launchpad/pages/data/export_data.py --mode server [args]` on the agent (as user `user`, via `su`).
- Shows export status (running/success/error).
- No admin panel or configuration.

## Installation

Enable plugins in the running MeshCentral configuration and install through the plugin manager. For manual installation, use `<meshcentral-data>/plugins/omniossendlogs/` and register `omniossendlogs` through the plugin database or `settings.plugins.list`.

### Updating an installed plugin

Version 1.3.0 adds correlated requests and agent-side permission checks. Update server, agent and browser together; older agents do not echo the required request IDs. Avoid updating cores during an export.

1. Copy the updated files into the installed plugin directory and use the plugin's **Reload** action.
2. Rebuild and synchronize the default core on a test device from an authenticated admin browser console:

   ```javascript
   meshserver.send({action: 'uploadagentcore', type: 'default', nodeids: ['node/<domain>/<device-id>']});
   ```

3. Wait for the agent core to become stable, then fully reload the device page.
4. Verify capabilities and an export before updating other devices. In this MeshCentral checkout, `distributeCore()` synchronizes the server's existing bundle; it does not rebuild edited modules from disk.

## Access and request handling

- Inventory/capability reads require device visibility. Starting any export requires **Agent Console** rights (`0x10`) on that device; the agent also enforces this on direct routed/console commands.
- Requests use the authenticated user's device rights and socket session. Results are matched to the originating agent and operation ID, with permissions checked again before delivery.
- An overlapping export returns a busy error instead of receiving another export's result. The agent also rejects overlapping exports.
- Offline/send failures return errors immediately. The server stops waiting for an export after 30 minutes, and the browser has a 31-minute fallback timeout. This does **not** cancel the device process: it may still run, and the agent stays busy until it finishes. Do not redistribute cores while it is running.

## Capability cache

Successful probes are cached on the agent for five minutes, including explicit `false` values. Old/malformed/expired caches are refreshed automatically. A failed/missing/timed-out `--help` produces an error and is not cached as unsupported. Simultaneous checks share a probe; the probe timeout is 20 seconds.

The **Refresh** link forces a new capability check. Browser checks expire after five minutes and are re-requested on device refresh; a lost response releases the browser's pending state so Refresh or a subsequent device refresh can retry without reloading the page.

## Usage

- Open a device on "My Devices" → General tab.
- Click "Export Logs" (or one of the "(last N min)" variants, once shown) to send the most recent logs for that window.
- Click "Export Trajectories" to include trajectory data.
- Click "Export Settings" (once enabled) to send just the `OmniPack`/`OmniControl` settings folders.
- Use "Refresh" to recheck Launchpad capabilities after an update or a failed probe.
- Status updates show the result reported by Launchpad; archive creation/upload is performed by Launchpad itself.

## Requirements

- The agent must have `/home/user/launchpad/pages/data/export_data.py` available and runnable as user `user`.
- `--settings-only` requires a Launchpad build that supports it; the plugin detects this itself and disables "Export Settings" otherwise.
- Requires OmniOSVersion plugin for proper positioning (optional, falls back to Hostname if not present).

## Configuration

The Python interpreter and script path can be changed in `modules_meshcore/omniossendlogs.js` by modifying the `PYTHON_BIN`/`EXPORT_SCRIPT`/`EXPORT_CWD` constants.

## Support

- Code comments and log messages are in English.

## Development

Run the regression tests with Node.js 18 or newer:

```sh
node --test tests/*.test.js
```
