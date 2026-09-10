# Changelog

## 1.3.0

- Check device access and Agent Console rights before exports; use authenticated sessions and verify agent replies.
- Correlate browser/server/agent requests, reject overlapping exports, and release server/browser pending state on timeout or delivery failure.
- Expire capabilities after five minutes, support forced refresh, and report failed probes without caching them as unsupported.
- Check settings/window support on the agent, bound process output, and quote SERIAL values in shell commands.
- Update server, agent core and browser together. Waiting timeouts do not cancel a running export process.
