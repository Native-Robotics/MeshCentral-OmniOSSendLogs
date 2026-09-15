# Changelog

## 1.3.1

- Recover from a WebSocket send failure to the agent instead of leaving an export stuck at "Running" until the 30-minute timeout.
- Export Trajectories skips session logs (`-l 0`) once the agent confirms the installed Launchpad supports it; older builds keep `-l 1`.

## 1.3.0

- Check device access and Agent Console rights before exports; use authenticated sessions and verify agent replies.
- Correlate browser/server/agent requests, reject overlapping exports, and release server/browser pending state on timeout or delivery failure.
- Expire capabilities after five minutes, support forced refresh, and report failed probes without caching them as unsupported.
- Check settings/window support on the agent, bound process output, and quote SERIAL values in shell commands.
- Update server, agent core and browser together. Waiting timeouts do not cancel a running export process.
