/**
 * @description MeshCentral Log Exporter Plugin
 * Adds a button to export device logs to server via console command.
 */

"use strict";

module.exports.omniossendlogs = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    // Client-side state (initialized when running in browser)
    obj.exportStatus = {}; // nodeid => { status, message, time }
    obj.settingsCapability = {}; // nodeid => true|false|undefined
    obj.windowCapability = {}; // nodeid => true|false|undefined (arbitrary log window support)

    obj.exports = [
        'onDeviceRefreshEnd',
        'exportResult',
        'triggerExport',
        'startExport',
        'requestExportCapabilities',
        'triggerExportTrajectories',
        'triggerExportSettings',
        'exportCapabilitiesResult',
        'injectGeneral',
        'escapeHtml'
    ];

    // MeshCentral dispatches browser plugin actions without checking node rights.
    // Use connection identity here; never accept a payload session or agent identity.
    obj.serveraction = function (command, myparent, grandparent) {
        if (!command || !myparent) return;
        var action = command.pluginaction;
        var requests = ["triggerExport", "triggerExportTrajectories", "triggerExportSettings", "checkExportCapabilities"];
        var results = ["exportResult", "exportCapabilitiesResult"];
        if (results.indexOf(action) !== -1) {
            if (!myparent.dbNodeKey || obj.meshServer.webserver.wsagents[myparent.dbNodeKey] !== myparent) return;
            handleAction(command, myparent, grandparent);
            return;
        }
        if (requests.indexOf(action) === -1 || myparent.dbNodeKey || !myparent.user || !myparent.domain || !myparent.ws) return;
        var nodeid = command.nodeid;
        function deny(message) {
            var method = action === 'checkExportCapabilities' ? 'exportCapabilitiesResult' : 'exportResult';
            try { myparent.ws.send(JSON.stringify({ action: 'plugin', plugin: 'omniossendlogs', method: method,
                data: { nodeid: nodeid, clientRequestId: command.clientRequestId, status: 'error', error: message, message: message } })); } catch (e) { }
        }
        if (typeof nodeid !== 'string' || nodeid.length > 128 || nodeid.split('/').length !== 3 ||
            nodeid.split('/')[0] !== 'node' || nodeid.split('/')[1] !== myparent.domain.id) {
            deny('Invalid device'); return;
        }
        obj.meshServer.webserver.GetNodeWithRights(myparent.domain, myparent.user, nodeid, function (node, rights, visible) {
            if (!node || !visible || (action !== 'checkExportCapabilities' && (rights & 16) === 0)) { deny('Access denied'); return; }
            var validated = { pluginaction: action, nodeid: node._id,
                rights: rights, force: command.force === true, window: command.window,
                clientRequestId: typeof command.clientRequestId === 'string' ? command.clientRequestId.slice(0, 100) : undefined };
            handleAction(validated, myparent, grandparent);
        });
    };
    // Every agent operation has an ID scoped to this server plugin instance.
    // A late reply after a timeout/reload must not finish a newer operation.
    var requestPrefix = require('crypto').randomBytes(12).toString('hex');
    var requestSequence = 0;
    obj.inflight = {};
    obj.capabilityInflight = {};

    function respond(client, method, data) {
        data.nodeid = client.nodeid;
        data.clientRequestId = client.clientRequestId;
        var web = obj.meshServer.webserver;
        if (web.wssessions2[client.ws.sessionId] !== client.ws) return;
        // Permissions may have changed while the agent was working.
        web.GetNodeWithRights(client.domain, client.user._id, client.nodeid, function (node, rights, visible) {
            var allowed = node && visible && (method !== 'exportResult' || (rights & 16) !== 0);
            var payload = allowed ? data : {nodeid: client.nodeid, clientRequestId: client.clientRequestId,
                status: 'error', error: 'Access denied', message: 'Access denied'};
            try { client.ws.send(JSON.stringify({ action: 'plugin', plugin: 'omniossendlogs', method: method, data: payload })); } catch (e) { }
        });
    }

    function complete(entry, data) {
        var map = entry.capability ? obj.capabilityInflight : obj.inflight;
        if (map[entry.nodeid] !== entry) return;
        clearTimeout(entry.timer);
        delete map[entry.nodeid];
        entry.clients.forEach(function (client) {
            respond(client, entry.capability ? 'exportCapabilitiesResult' : 'exportResult', Object.assign({}, data));
        });
    }

    function handleAction(command, myparent, grandparent) {
        if (command.pluginaction === 'exportResult' || command.pluginaction === 'exportCapabilitiesResult') {
            var capability = command.pluginaction === 'exportCapabilitiesResult';
            var map = capability ? obj.capabilityInflight : obj.inflight;
            var entry = map[myparent.dbNodeKey];
            if (!entry || entry.agent !== myparent || command.requestId !== entry.id) return;
            if (capability) {
                if (command.error || typeof command.settingsOnly !== 'boolean' || typeof command.arbitraryWindow !== 'boolean') {
                    complete(entry, {error: String(command.error || 'Invalid capability response')});
                } else complete(entry, {settingsOnly: command.settingsOnly, arbitraryWindow: command.arbitraryWindow});
            } else complete(entry, {status: command.success === true ? 'success' : 'error',
                message: String(command.message || (command.success === true ? 'Export completed' : 'Export failed')).slice(-65536)});
            return;
        }
        var nodeid = command.nodeid;
        var capability = command.pluginaction === 'checkExportCapabilities';
        var map = capability ? obj.capabilityInflight : obj.inflight;
        var method = capability ? 'exportCapabilitiesResult' : 'exportResult';
        var client = {ws: myparent.ws, user: myparent.user, domain: myparent.domain,
            nodeid: nodeid, clientRequestId: command.clientRequestId};
        if (map[nodeid] && map[nodeid].agent !== obj.meshServer.webserver.wsagents[nodeid]) {
            complete(map[nodeid], {status: 'error', error: 'Device connection changed', message: 'Device connection changed; previous export status is unknown'});
        }
        if (map[nodeid]) {
            if (capability) {
                // Repeated requests from one tab replace its waiter rather than grow the list.
                map[nodeid].clients = map[nodeid].clients.filter(function (c) { return c.ws !== client.ws; });
                map[nodeid].clients.push(client);
            } else respond(client, method, {status: 'error', message: 'Another export is already running on this device'});
            return;
        }
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (!agent) { respond(client, method, {status: 'error', error: 'Device is offline', message: 'Device is offline'}); return; }
        var entry = {id: requestPrefix + '-' + (++requestSequence), nodeid: nodeid, agent: agent,
            capability: capability, clients: [client]};
        map[nodeid] = entry;
        entry.timer = setTimeout(function () {
            complete(entry, {status: 'error', error: 'No response from device',
                message: capability ? 'Capability check timed out' : 'Timed out waiting for export; it may still be running on the device'});
        }, capability ? 30000 : 30 * 60 * 1000);
        var actions = {triggerExport: 'runExport', triggerExportTrajectories: 'runExportTrajectories',
            triggerExportSettings: 'runExportSettings', checkExportCapabilities: 'checkExportCapabilities'};
        var request = {action: 'plugin', plugin: 'omniossendlogs', pluginaction: actions[command.pluginaction],
            requestId: entry.id, rights: command.rights, force: command.force === true};
        if (command.pluginaction === 'triggerExport' && ['30m', '60m', '120m'].indexOf(command.window) !== -1) request.window = command.window;
        if (!capability) respond(client, method, {status: 'running', message: 'Export started...'});
        try { agent.send(JSON.stringify(request)); }
        catch (e) { complete(entry, {status: 'error', error: 'Cannot contact device', message: 'Cannot contact device'}); }
    }

    // --- web hooks ---
    obj.registerPluginTab = function () { return null; };
    obj.on_device_page = function () { return null; };

    // --- client-side helpers ---
    obj.escapeHtml = function (unsafe) {
        if (unsafe == null) return '';
        return String(unsafe)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    obj.injectGeneral = function () {
        console.log('[omniossendlogs] injectGeneral called');
        if (typeof document === 'undefined') {
            console.log('[omniossendlogs] document is undefined (server-side)');
            return;
        }
        if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) {
            console.log('[omniossendlogs] currentNode undefined or invalid');
            return;
        }

        // Find the General content area
        var p10html = Q('p10html');
        if (!p10html) {
            console.log('[omniossendlogs] p10html element not found');
            return;
        }

        var table = p10html.querySelector('table');
        if (!table) {
            console.log('[omniossendlogs] Table not found in p10html');
            return;
        }

        // Check for existing row to update in-place
        var existingRow = table.querySelector('#omniossendlogsTableRow');

        // Get current status
        pluginHandler.omniossendlogs.exportStatus = pluginHandler.omniossendlogs.exportStatus || {};
        var status = pluginHandler.omniossendlogs.exportStatus[currentNode._id] || null;
        var statusHtml = '';
        var linkStyle = '';

        if (status) {
            if (status.status === 'running') {
                statusHtml = ' <span style="color:#007bff;">⏳ Running...</span>';
                linkStyle = 'pointer-events:none;opacity:0.5;';
            } else if (status.status === 'success') {
                statusHtml = ' <span style="color:#28a745;">✓ ' + pluginHandler.omniossendlogs.escapeHtml(status.message) + '</span>';
            } else if (status.status === 'error') {
                statusHtml = ' <span style="color:#dc3545;">✗ ' + pluginHandler.omniossendlogs.escapeHtml(status.message) + '</span>';
            }
        }

        // "Export Settings" is additionally gated on the agent having
        // confirmed support (see onDeviceRefreshEnd/exportCapabilitiesResult)
        // - disabled while unknown/unsupported, on top of the "running" gate
        // the other links use, so it can never be clicked into a doomed
        // export on an old Launchpad.
        pluginHandler.omniossendlogs.settingsCapability = pluginHandler.omniossendlogs.settingsCapability || {};
        var settingsSupported = pluginHandler.omniossendlogs.settingsCapability[currentNode._id];
        var settingsLinkStyle = linkStyle;
        var settingsTitleAttr = '';
        if (settingsSupported !== true) {
            settingsLinkStyle = 'pointer-events:none;opacity:0.5;';
            settingsTitleAttr = settingsSupported === false
                ? ' title="Requires a newer Launchpad on this device (no --settings-only support)"'
                : ' title="Checking Launchpad support..."';
        }
        var settingsLinkHtml = '&nbsp;&nbsp;<a href="#" style="' + settingsLinkStyle + '"' + settingsTitleAttr +
            ' onclick="pluginHandler.omniossendlogs.triggerExportSettings(); return false;">Export Settings</a>';

        // Once the agent confirms arbitrary log-window support, offer the
        // three fixed durations directly instead of leaving the agent to
        // pick one via its own probe-based cascade - no per-link gating
        // needed beyond this single check, since all three values are
        // already known-good once arbitraryWindow is true.
        pluginHandler.omniossendlogs.windowCapability = pluginHandler.omniossendlogs.windowCapability || {};
        var exportLogsHtml;
        if (pluginHandler.omniossendlogs.windowCapability[currentNode._id] === true) {
            exportLogsHtml =
                '<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExport(\'30m\'); return false;">Export Logs (last 30 min)</a>' +
                '&nbsp;<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExport(\'60m\'); return false;">(last 60 min)</a>' +
                '&nbsp;<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExport(\'120m\'); return false;">(last 120 min)</a>';
        } else {
            exportLogsHtml = '<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExport(); return false;">Export Logs</a>';
        }

        var capabilityError = (pluginHandler.omniossendlogs.capabilityErrors || {})[currentNode._id];
        settingsLinkHtml += ' &nbsp;<a href="#" onclick="pluginHandler.omniossendlogs.requestExportCapabilities(true); return false;">Refresh</a>';
        if (capabilityError) settingsLinkHtml += ' <span style="color:#dc3545;">' + pluginHandler.omniossendlogs.escapeHtml(capabilityError) + '</span>';

        // If row exists, update it and exit (prevents flickering and deletion issues)
        if (existingRow) {
            var contentCell = existingRow.querySelector('td:nth-child(2)');
            if (contentCell) {
                contentCell.innerHTML = exportLogsHtml +
                    '&nbsp;&nbsp;<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExportTrajectories(); return false;">Export Trajectories</a>' +
                    settingsLinkHtml +
                    statusHtml;
            }
            return;
        }

        // Find insertion point: after Apps row (from omniosversion) or before Hostname
        var insertAfter = null;
        var hostnameRow = null;
        var appsRow = null;

        // Look for Apps row and Hostname row
        var rows = table.getElementsByTagName('tr');
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i].getElementsByTagName('td');
            if (cells.length > 0) {
                var cellText = cells[0].textContent || cells[0].innerText;
                if (cellText) {
                    var trimmed = cellText.trim();
                    // Apps row may have count like "Apps (3)"
                    if (trimmed === 'Apps' || trimmed.indexOf('Apps') === 0) {
                        appsRow = rows[i];
                    }
                    if (trimmed === 'Hostname') {
                        hostnameRow = rows[i];
                    }
                }
            }
        }

        // Determine insertion point
        if (appsRow) {
            insertAfter = appsRow;
        }

        // Create the export row HTML
        var rowHtml = '<tr id="omniossendlogsTableRow"><td class="style7">Export</td><td class="style9">' +
            exportLogsHtml +
            '&nbsp;&nbsp;<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExportTrajectories(); return false;">Export Trajectories</a>' +
            settingsLinkHtml +
            statusHtml +
            '</td></tr>';

        // Insert the row
        if (insertAfter) {
            insertAfter.insertAdjacentHTML('afterend', rowHtml);
            console.log('[omniossendlogs] Export row injected after Apps row');
        } else if (hostnameRow) {
            hostnameRow.insertAdjacentHTML('beforebegin', rowHtml);
            console.log('[omniossendlogs] Export row injected before Hostname row');
        } else {
            // Fallback: insert at the beginning
            var tbody = table.querySelector('tbody') || table;
            if (tbody.children.length > 0) {
                tbody.children[0].insertAdjacentHTML('afterend', rowHtml);
            } else {
                tbody.insertAdjacentHTML('beforeend', rowHtml);
            }
            console.log('[omniossendlogs] Export row injected at fallback position');
        }
    };

    obj.triggerExport = function (window) {
        return pluginHandler.omniossendlogs.startExport('triggerExport', window);
    };
    obj.triggerExportTrajectories = function () {
        return pluginHandler.omniossendlogs.startExport('triggerExportTrajectories');
    };
    obj.triggerExportSettings = function () {
        if (typeof currentNode === 'undefined' || !currentNode) return false;
        if ((pluginHandler.omniossendlogs.settingsCapability || {})[currentNode._id] !== true) return false;
        return pluginHandler.omniossendlogs.startExport('triggerExportSettings');
    };
    obj.startExport = function (action, window) {
        if (typeof meshserver === 'undefined' || typeof currentNode === 'undefined' || !currentNode) return false;
        var h = pluginHandler.omniossendlogs, nodeid = currentNode._id;
        h.exportStatus = h.exportStatus || {};
        if (h.exportStatus[nodeid] && h.exportStatus[nodeid].status === 'running') return false;
        h.requestSequence = (h.requestSequence || 0) + 1;
        var id = Date.now() + '-' + h.requestSequence;
        h.exportRequests = h.exportRequests || {};
        h.exportRequests[nodeid] = id;
        h.exportStatus[nodeid] = {status: 'running', message: 'Export started...', time: Date.now()};
        h.injectGeneral();
        function fail(message) {
            h.exportResult(null, {data: {nodeid: nodeid, clientRequestId: id, status: 'error', message: message}});
        }
        try { meshserver.send({action: 'plugin', plugin: 'omniossendlogs', pluginaction: action,
            nodeid: nodeid, window: window, clientRequestId: id}); }
        catch (e) { fail('Cannot contact MeshCentral'); }
        setTimeout(function () {
            if (h.exportRequests[nodeid] === id) fail('No response from MeshCentral; export may still be running on the device');
        }, 31 * 60 * 1000);
        return false;
    };
    obj.exportResult = function (state, msg) {
        if (!msg || !msg.data || !msg.data.nodeid) return;
        var h = pluginHandler.omniossendlogs, data = msg.data, nodeid = data.nodeid;
        if (!h.exportRequests || !h.exportRequests[nodeid] || h.exportRequests[nodeid] !== data.clientRequestId) return;
        h.exportStatus = h.exportStatus || {};
        var status = {status: data.status, message: data.message, time: Date.now()};
        h.exportStatus[nodeid] = status;
        if (data.status !== 'running') {
            delete h.exportRequests[nodeid];
            setTimeout(function () {
                if (h.exportStatus[nodeid] !== status) return;
                delete h.exportStatus[nodeid];
                if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeid) h.injectGeneral();
            }, 10000);
        }
        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeid) h.injectGeneral();
    };
    obj.requestExportCapabilities = function (force) {
        if (typeof meshserver === 'undefined' || typeof currentNode === 'undefined' || !currentNode) return;
        var h = pluginHandler.omniossendlogs, nodeid = currentNode._id;
        h.capabilityRequests = h.capabilityRequests || {};
        h.capabilityChecked = h.capabilityChecked || {};
        h.capabilityErrors = h.capabilityErrors || {};
        if (h.capabilityRequests[nodeid]) return;
        if (!force && h.capabilityChecked[nodeid] && Date.now() - h.capabilityChecked[nodeid] < 300000) return;
        h.requestSequence = (h.requestSequence || 0) + 1;
        var id = Date.now() + '-' + h.requestSequence;
        h.capabilityRequests[nodeid] = id;
        delete h.capabilityErrors[nodeid];
        function fail(message) {
            h.exportCapabilitiesResult(null, {data: {nodeid: nodeid, clientRequestId: id, error: message}});
        }
        try { meshserver.send({action: 'plugin', plugin: 'omniossendlogs', pluginaction: 'checkExportCapabilities',
            nodeid: nodeid, force: force === true, clientRequestId: id}); }
        catch (e) { fail('Cannot contact MeshCentral'); }
        setTimeout(function () {
            if (h.capabilityRequests[nodeid] === id) fail('Capability check timed out; use Refresh');
        }, 35000);
    };
    obj.exportCapabilitiesResult = function (state, msg) {
        if (!msg || !msg.data || !msg.data.nodeid) return;
        var h = pluginHandler.omniossendlogs, data = msg.data, nodeid = data.nodeid;
        if (!h.capabilityRequests || !h.capabilityRequests[nodeid] || h.capabilityRequests[nodeid] !== data.clientRequestId) return;
        delete h.capabilityRequests[nodeid];
        h.settingsCapability = h.settingsCapability || {};
        h.windowCapability = h.windowCapability || {};
        h.capabilityChecked = h.capabilityChecked || {};
        h.capabilityErrors = h.capabilityErrors || {};
        if (data.error || typeof data.settingsOnly !== 'boolean' || typeof data.arbitraryWindow !== 'boolean') {
            delete h.settingsCapability[nodeid];
            delete h.windowCapability[nodeid];
            delete h.capabilityChecked[nodeid];
            h.capabilityErrors[nodeid] = data.error || 'Invalid capability response';
        } else {
            h.settingsCapability[nodeid] = data.settingsOnly;
            h.windowCapability[nodeid] = data.arbitraryWindow;
            h.capabilityChecked[nodeid] = Date.now();
            delete h.capabilityErrors[nodeid];
        }
        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeid) h.injectGeneral();
    };
    obj.onDeviceRefreshEnd = function () {
        var h = pluginHandler.omniossendlogs;
        h.injectGeneral();
        h.requestExportCapabilities(false);
    };

    // --- admin panel stub (not used) ---
    obj.handleAdminReq = function (req, res, user) { res.sendStatus(401); };
    obj.handleAdminPostReq = function (req, res, user) { res.sendStatus(401); };

    return obj;
};
