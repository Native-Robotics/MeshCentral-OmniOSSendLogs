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
    obj.pending = {}; // nodeid => [sessionIds]
    obj.inflight = {}; // nodeid => boolean
    obj.lastResult = {}; // nodeid => { success, message, time }

    // Settings-export capability check state (separate from the export
    // state above so a capability check never blocks or is blocked by an
    // in-flight export)
    obj.capabilityCache = {}; // nodeid => true|false
    obj.capabilityInflight = {}; // nodeid => boolean
    obj.capabilityPending = {}; // nodeid => [sessionIds]

    // Client-side state (initialized when running in browser)
    obj.exportStatus = {}; // nodeid => { status, message, time }
    obj.settingsCapability = {}; // nodeid => true|false|undefined
    obj.settingsCapabilityAsked = {}; // nodeid => boolean

    obj.exports = [
        'onDeviceRefreshEnd',
        'exportResult',
        'triggerExport',
        'triggerExportTrajectories',
        'triggerExportSettings',
        'settingsCapabilityResult',
        'injectGeneral',
        'escapeHtml'
    ];

    // --- server-side helpers ---
    obj.sendToSession = function (sessionid, myparent, msg, grandparent) {
        if (sessionid && grandparent && grandparent.wssessions2 && grandparent.wssessions2[sessionid]) {
            try { grandparent.wssessions2[sessionid].send(JSON.stringify(msg)); return; } catch (e) { }
        }
        if (myparent && myparent.ws) {
            try { myparent.ws.send(JSON.stringify(msg)); } catch (e) { }
        }
    };

    obj.queueSession = function (nodeid, sessionid) {
        if (!nodeid || !sessionid) return;
        if (!obj.pending[nodeid]) obj.pending[nodeid] = [];
        if (obj.pending[nodeid].indexOf(sessionid) === -1) obj.pending[nodeid].push(sessionid);
    };

    obj.flushPending = function (nodeid, msg, grandparent) {
        if (!obj.pending[nodeid]) return;
        var sessions = obj.pending[nodeid];
        obj.pending[nodeid] = [];
        for (var i = 0; i < sessions.length; i++) {
            var sid = sessions[i];
            if (grandparent && grandparent.wssessions2 && grandparent.wssessions2[sid]) {
                try { grandparent.wssessions2[sid].send(JSON.stringify(msg)); } catch (e) { }
            }
        }
    };

    obj.capabilityQueueSession = function (nodeid, sessionid) {
        if (!nodeid || !sessionid) return;
        if (!obj.capabilityPending[nodeid]) obj.capabilityPending[nodeid] = [];
        if (obj.capabilityPending[nodeid].indexOf(sessionid) === -1) obj.capabilityPending[nodeid].push(sessionid);
    };

    obj.capabilityFlushPending = function (nodeid, msg, grandparent) {
        if (!obj.capabilityPending[nodeid]) return;
        var sessions = obj.capabilityPending[nodeid];
        obj.capabilityPending[nodeid] = [];
        for (var i = 0; i < sessions.length; i++) {
            var sid = sessions[i];
            if (grandparent && grandparent.wssessions2 && grandparent.wssessions2[sid]) {
                try { grandparent.wssessions2[sid].send(JSON.stringify(msg)); } catch (e) { }
            }
        }
    };

    obj.requestExportFromAgent = function (nodeid) {
        obj.debug('omniossendlogs', 'requestExportFromAgent called for:', nodeid);
        if (!nodeid) { obj.debug('omniossendlogs', 'requestExportFromAgent: no nodeid'); return; }
        if (obj.inflight[nodeid]) { obj.debug('omniossendlogs', 'requestExportFromAgent: already inflight for', nodeid); return; }
        obj.inflight[nodeid] = true;
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (agent == null) {
            obj.debug('omniossendlogs', 'requestExportFromAgent: agent not found for', nodeid);
            obj.inflight[nodeid] = false;
            return;
        }
        try {
            obj.debug('omniossendlogs', 'requestExportFromAgent: sending runExport command to', nodeid);
            agent.send(JSON.stringify({ action: 'plugin', plugin: 'omniossendlogs', pluginaction: 'runExport' }));
        } catch (e) {
            obj.debug('omniossendlogs', 'requestExportFromAgent: error sending to agent', nodeid, e);
            obj.inflight[nodeid] = false;
        }
    };

    obj.requestExportTrajectoriesFromAgent = function (nodeid) {
        obj.debug('omniossendlogs', 'requestExportTrajectoriesFromAgent called for:', nodeid);
        if (!nodeid) { obj.debug('omniossendlogs', 'requestExportTrajectoriesFromAgent: no nodeid'); return; }
        if (obj.inflight[nodeid]) { obj.debug('omniossendlogs', 'requestExportTrajectoriesFromAgent: already inflight for', nodeid); return; }
        obj.inflight[nodeid] = true;
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (agent == null) {
            obj.debug('omniossendlogs', 'requestExportTrajectoriesFromAgent: agent not found for', nodeid);
            obj.inflight[nodeid] = false;
            return;
        }
        try {
            obj.debug('omniossendlogs', 'requestExportTrajectoriesFromAgent: sending runExportTrajectories command to', nodeid);
            agent.send(JSON.stringify({ action: 'plugin', plugin: 'omniossendlogs', pluginaction: 'runExportTrajectories' }));
        } catch (e) {
            obj.debug('omniossendlogs', 'requestExportTrajectoriesFromAgent: error sending to agent', nodeid, e);
            obj.inflight[nodeid] = false;
        }
    };

    obj.requestExportSettingsFromAgent = function (nodeid) {
        obj.debug('omniossendlogs', 'requestExportSettingsFromAgent called for:', nodeid);
        if (!nodeid) { obj.debug('omniossendlogs', 'requestExportSettingsFromAgent: no nodeid'); return; }
        if (obj.inflight[nodeid]) { obj.debug('omniossendlogs', 'requestExportSettingsFromAgent: already inflight for', nodeid); return; }
        obj.inflight[nodeid] = true;
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (agent == null) {
            obj.debug('omniossendlogs', 'requestExportSettingsFromAgent: agent not found for', nodeid);
            obj.inflight[nodeid] = false;
            return;
        }
        try {
            obj.debug('omniossendlogs', 'requestExportSettingsFromAgent: sending runExportSettings command to', nodeid);
            agent.send(JSON.stringify({ action: 'plugin', plugin: 'omniossendlogs', pluginaction: 'runExportSettings' }));
        } catch (e) {
            obj.debug('omniossendlogs', 'requestExportSettingsFromAgent: error sending to agent', nodeid, e);
            obj.inflight[nodeid] = false;
        }
    };

    obj.requestSettingsCapabilityFromAgent = function (nodeid) {
        obj.debug('omniossendlogs', 'requestSettingsCapabilityFromAgent called for:', nodeid);
        if (!nodeid) { obj.debug('omniossendlogs', 'requestSettingsCapabilityFromAgent: no nodeid'); return; }
        if (obj.capabilityInflight[nodeid]) { obj.debug('omniossendlogs', 'requestSettingsCapabilityFromAgent: already inflight for', nodeid); return; }
        obj.capabilityInflight[nodeid] = true;
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (agent == null) {
            obj.debug('omniossendlogs', 'requestSettingsCapabilityFromAgent: agent not found for', nodeid);
            obj.capabilityInflight[nodeid] = false;
            return;
        }
        try {
            obj.debug('omniossendlogs', 'requestSettingsCapabilityFromAgent: sending checkSettingsCapability command to', nodeid);
            agent.send(JSON.stringify({ action: 'plugin', plugin: 'omniossendlogs', pluginaction: 'checkSettingsCapability' }));
        } catch (e) {
            obj.debug('omniossendlogs', 'requestSettingsCapabilityFromAgent: error sending to agent', nodeid, e);
            obj.capabilityInflight[nodeid] = false;
        }
    };

    // --- hooks ---
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        obj.debug('omniossendlogs', 'hook_agentCoreIsStable called for node:', myparent.dbNodeKey);
        // No automatic action on agent connect
    };

    obj.serveraction = function (command, myparent, grandparent) {
        obj.debug('omniossendlogs', 'serveraction received:', command.pluginaction);
        switch (command.pluginaction) {
            case 'triggerExport': {
                var nodeid = command.nodeid || myparent.dbNodeKey;
                obj.debug('omniossendlogs', 'triggerExport request for node:', nodeid);
                if (!nodeid) {
                    obj.debug('omniossendlogs', 'triggerExport: no nodeid');
                    return;
                }
                // Resolve session ID: browser does not send it explicitly, so derive from the WS connection
                var sessionid = command.sessionid || (myparent.ws && myparent.ws.sessionId);
                obj.debug('omniossendlogs', 'triggerExport: sessionid resolved as:', sessionid);
                // Send immediate "running" status
                var runningMsg = {
                    action: 'plugin',
                    plugin: 'omniossendlogs',
                    method: 'exportResult',
                    data: { nodeid: nodeid, status: 'running', message: 'Export started...' }
                };
                obj.sendToSession(sessionid, myparent, runningMsg, grandparent);
                obj.queueSession(nodeid, sessionid);
                obj.requestExportFromAgent(nodeid);
                break;
            }
            case 'triggerExportTrajectories': {
                var nodeid = command.nodeid || myparent.dbNodeKey;
                obj.debug('omniossendlogs', 'triggerExportTrajectories request for node:', nodeid);
                if (!nodeid) {
                    obj.debug('omniossendlogs', 'triggerExportTrajectories: no nodeid');
                    return;
                }
                var sessionid = command.sessionid || (myparent.ws && myparent.ws.sessionId);
                obj.debug('omniossendlogs', 'triggerExportTrajectories: sessionid resolved as:', sessionid);
                var runningMsg = {
                    action: 'plugin',
                    plugin: 'omniossendlogs',
                    method: 'exportResult',
                    data: { nodeid: nodeid, status: 'running', message: 'Trajectories export started...' }
                };
                obj.sendToSession(sessionid, myparent, runningMsg, grandparent);
                obj.queueSession(nodeid, sessionid);
                obj.requestExportTrajectoriesFromAgent(nodeid);
                break;
            }
            case 'triggerExportSettings': {
                var nodeid = command.nodeid || myparent.dbNodeKey;
                obj.debug('omniossendlogs', 'triggerExportSettings request for node:', nodeid);
                if (!nodeid) {
                    obj.debug('omniossendlogs', 'triggerExportSettings: no nodeid');
                    return;
                }
                var sessionid = command.sessionid || (myparent.ws && myparent.ws.sessionId);
                obj.debug('omniossendlogs', 'triggerExportSettings: sessionid resolved as:', sessionid);
                var runningMsg = {
                    action: 'plugin',
                    plugin: 'omniossendlogs',
                    method: 'exportResult',
                    data: { nodeid: nodeid, status: 'running', message: 'Settings export started...' }
                };
                obj.sendToSession(sessionid, myparent, runningMsg, grandparent);
                obj.queueSession(nodeid, sessionid);
                obj.requestExportSettingsFromAgent(nodeid);
                break;
            }
            case 'checkSettingsCapability': {
                var nodeid = command.nodeid || myparent.dbNodeKey;
                obj.debug('omniossendlogs', 'checkSettingsCapability request for node:', nodeid);
                if (!nodeid) {
                    obj.debug('omniossendlogs', 'checkSettingsCapability: no nodeid');
                    return;
                }
                var sessionid = command.sessionid || (myparent.ws && myparent.ws.sessionId);

                if (obj.capabilityCache.hasOwnProperty(nodeid)) {
                    obj.debug('omniossendlogs', 'checkSettingsCapability: answering from cache for', nodeid);
                    var cachedMsg = {
                        action: 'plugin',
                        plugin: 'omniossendlogs',
                        method: 'settingsCapabilityResult',
                        data: { nodeid: nodeid, supported: obj.capabilityCache[nodeid] }
                    };
                    obj.sendToSession(sessionid, myparent, cachedMsg, grandparent);
                    break;
                }

                obj.capabilityQueueSession(nodeid, sessionid);
                obj.requestSettingsCapabilityFromAgent(nodeid);
                break;
            }
            case 'exportResult': {
                var node = myparent.dbNodeKey;
                obj.debug('omniossendlogs', 'exportResult received from agent:', node, 'success:', command.success);
                if (!node) {
                    obj.debug('omniossendlogs', 'exportResult: no node');
                    return;
                }
                obj.lastResult[node] = {
                    success: command.success,
                    message: command.message || (command.success ? 'Export completed' : 'Export failed'),
                    time: Date.now()
                };
                var outMsg = {
                    action: 'plugin',
                    plugin: 'omniossendlogs',
                    method: 'exportResult',
                    data: {
                        nodeid: node,
                        status: command.success ? 'success' : 'error',
                        message: obj.lastResult[node].message
                    }
                };
                obj.debug('omniossendlogs', 'exportResult: flushing to pending sessions');
                obj.flushPending(node, outMsg, grandparent);
                obj.inflight[node] = false;
                break;
            }
            case 'settingsCapabilityResult': {
                var node = myparent.dbNodeKey;
                obj.debug('omniossendlogs', 'settingsCapabilityResult received from agent:', node, 'supported:', command.supported);
                if (!node) {
                    obj.debug('omniossendlogs', 'settingsCapabilityResult: no node');
                    return;
                }
                obj.capabilityCache[node] = !!command.supported;
                obj.capabilityInflight[node] = false;
                var outMsg = {
                    action: 'plugin',
                    plugin: 'omniossendlogs',
                    method: 'settingsCapabilityResult',
                    data: { nodeid: node, supported: obj.capabilityCache[node] }
                };
                obj.debug('omniossendlogs', 'settingsCapabilityResult: flushing to pending sessions');
                obj.capabilityFlushPending(node, outMsg, grandparent);
                break;
            }
            default:
                obj.debug('omniossendlogs', 'Unknown pluginaction:', command.pluginaction);
                break;
        }
    };

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
        // confirmed support (see onDeviceRefreshEnd/settingsCapabilityResult)
        // - disabled while unknown/unsupported, on top of the "running" gate
        // the other two links use, so it can never be clicked into a doomed
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

        // If row exists, update it and exit (prevents flickering and deletion issues)
        if (existingRow) {
            var contentCell = existingRow.querySelector('td:nth-child(2)');
            if (contentCell) {
                contentCell.innerHTML = '<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExport(); return false;">Export Logs</a>' +
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
            '<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExport(); return false;">Export Logs</a>' +
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

    obj.triggerExport = function () {
        console.log('[omniossendlogs] triggerExport called');
        if (typeof meshserver === 'undefined' || typeof currentNode === 'undefined' || !currentNode) {
            console.log('[omniossendlogs] meshserver or currentNode undefined');
            return false;
        }

        // Check if already running
        pluginHandler.omniossendlogs.exportStatus = pluginHandler.omniossendlogs.exportStatus || {};
        var status = pluginHandler.omniossendlogs.exportStatus[currentNode._id];
        if (status && status.status === 'running') {
            console.log('[omniossendlogs] Export already running');
            return false;
        }

        var nodeId = currentNode._id;

        // Set running status immediately for UI feedback
        pluginHandler.omniossendlogs.exportStatus[nodeId] = {
            status: 'running',
            message: 'Export started...',
            time: Date.now()
        };
        pluginHandler.omniossendlogs.injectGeneral();

        // Send request to server
        console.log('[omniossendlogs] Sending triggerExport request for node:', nodeId);
        meshserver.send({
            action: 'plugin',
            plugin: 'omniossendlogs',
            pluginaction: 'triggerExport',
            nodeid: nodeId
        });

        // Timeout handler to clear "Running" state if no response
        setTimeout(function () {
            var s = pluginHandler.omniossendlogs.exportStatus[nodeId];
            if (s && s.status === 'running') {
                console.log('[omniossendlogs] Export timed out for node:', nodeId);
                pluginHandler.omniossendlogs.exportStatus[nodeId] = {
                    status: 'error',
                    message: 'Timeout: No response',
                    time: Date.now()
                };

                // Update UI if still on the same node
                if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeId) {
                    pluginHandler.omniossendlogs.injectGeneral();
                }

                // Clear error message after 10 seconds
                setTimeout(function () {
                    var errStatus = pluginHandler.omniossendlogs.exportStatus[nodeId];
                    if (errStatus && errStatus.status === 'error' && errStatus.message === 'Timeout: No response') {
                        delete pluginHandler.omniossendlogs.exportStatus[nodeId];
                        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeId) {
                            pluginHandler.omniossendlogs.injectGeneral();
                        }
                    }
                }, 10000);
            }
        }, 60000); // 60 seconds timeout

        return false;
    };

    obj.triggerExportTrajectories = function () {
        console.log('[omniossendlogs] triggerExportTrajectories called');
        if (typeof meshserver === 'undefined' || typeof currentNode === 'undefined' || !currentNode) {
            console.log('[omniossendlogs] meshserver or currentNode undefined');
            return false;
        }

        pluginHandler.omniossendlogs.exportStatus = pluginHandler.omniossendlogs.exportStatus || {};
        var status = pluginHandler.omniossendlogs.exportStatus[currentNode._id];
        if (status && status.status === 'running') {
            console.log('[omniossendlogs] Export already running');
            return false;
        }

        var nodeId = currentNode._id;

        pluginHandler.omniossendlogs.exportStatus[nodeId] = {
            status: 'running',
            message: 'Trajectories export started...',
            time: Date.now()
        };
        pluginHandler.omniossendlogs.injectGeneral();

        console.log('[omniossendlogs] Sending triggerExportTrajectories request for node:', nodeId);
        meshserver.send({
            action: 'plugin',
            plugin: 'omniossendlogs',
            pluginaction: 'triggerExportTrajectories',
            nodeid: nodeId
        });

        setTimeout(function () {
            var s = pluginHandler.omniossendlogs.exportStatus[nodeId];
            if (s && s.status === 'running') {
                console.log('[omniossendlogs] Trajectories export timed out for node:', nodeId);
                pluginHandler.omniossendlogs.exportStatus[nodeId] = {
                    status: 'error',
                    message: 'Timeout: No response',
                    time: Date.now()
                };
                if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeId) {
                    pluginHandler.omniossendlogs.injectGeneral();
                }
                setTimeout(function () {
                    var errStatus = pluginHandler.omniossendlogs.exportStatus[nodeId];
                    if (errStatus && errStatus.status === 'error' && errStatus.message === 'Timeout: No response') {
                        delete pluginHandler.omniossendlogs.exportStatus[nodeId];
                        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeId) {
                            pluginHandler.omniossendlogs.injectGeneral();
                        }
                    }
                }, 10000);
            }
        }, 60000);

        return false;
    };

    obj.triggerExportSettings = function () {
        console.log('[omniossendlogs] triggerExportSettings called');
        if (typeof meshserver === 'undefined' || typeof currentNode === 'undefined' || !currentNode) {
            console.log('[omniossendlogs] meshserver or currentNode undefined');
            return false;
        }

        // Defense in depth: pointer-events:none in injectGeneral should
        // already prevent this click while support isn't confirmed, but the
        // handler must not rely on CSS alone.
        pluginHandler.omniossendlogs.settingsCapability = pluginHandler.omniossendlogs.settingsCapability || {};
        if (pluginHandler.omniossendlogs.settingsCapability[currentNode._id] !== true) {
            console.log('[omniossendlogs] triggerExportSettings: capability not confirmed, ignoring click');
            return false;
        }

        pluginHandler.omniossendlogs.exportStatus = pluginHandler.omniossendlogs.exportStatus || {};
        var status = pluginHandler.omniossendlogs.exportStatus[currentNode._id];
        if (status && status.status === 'running') {
            console.log('[omniossendlogs] Export already running');
            return false;
        }

        var nodeId = currentNode._id;

        pluginHandler.omniossendlogs.exportStatus[nodeId] = {
            status: 'running',
            message: 'Settings export started...',
            time: Date.now()
        };
        pluginHandler.omniossendlogs.injectGeneral();

        console.log('[omniossendlogs] Sending triggerExportSettings request for node:', nodeId);
        meshserver.send({
            action: 'plugin',
            plugin: 'omniossendlogs',
            pluginaction: 'triggerExportSettings',
            nodeid: nodeId
        });

        setTimeout(function () {
            var s = pluginHandler.omniossendlogs.exportStatus[nodeId];
            if (s && s.status === 'running') {
                console.log('[omniossendlogs] Settings export timed out for node:', nodeId);
                pluginHandler.omniossendlogs.exportStatus[nodeId] = {
                    status: 'error',
                    message: 'Timeout: No response',
                    time: Date.now()
                };
                if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeId) {
                    pluginHandler.omniossendlogs.injectGeneral();
                }
                setTimeout(function () {
                    var errStatus = pluginHandler.omniossendlogs.exportStatus[nodeId];
                    if (errStatus && errStatus.status === 'error' && errStatus.message === 'Timeout: No response') {
                        delete pluginHandler.omniossendlogs.exportStatus[nodeId];
                        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === nodeId) {
                            pluginHandler.omniossendlogs.injectGeneral();
                        }
                    }
                }, 10000);
            }
        }, 60000);

        return false;
    };

    obj.exportResult = function (state, msg) {
        console.log('[omniossendlogs] exportResult received:', msg);
        if (!msg || !msg.data || !msg.data.nodeid) {
            console.log('[omniossendlogs] exportResult: invalid message structure');
            return;
        }

        pluginHandler.omniossendlogs.exportStatus = pluginHandler.omniossendlogs.exportStatus || {};
        pluginHandler.omniossendlogs.exportStatus[msg.data.nodeid] = {
            status: msg.data.status,
            message: msg.data.message,
            time: Date.now()
        };

        // Update UI if this is the current node
        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === msg.data.nodeid) {
            pluginHandler.omniossendlogs.injectGeneral();
        }

        // Clear status after 10 seconds for success/error
        if (msg.data.status !== 'running') {
            setTimeout(function () {
                var currentStatus = pluginHandler.omniossendlogs.exportStatus[msg.data.nodeid];
                if (currentStatus && currentStatus.time && (Date.now() - currentStatus.time) >= 9000) {
                    delete pluginHandler.omniossendlogs.exportStatus[msg.data.nodeid];
                    if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === msg.data.nodeid) {
                        pluginHandler.omniossendlogs.injectGeneral();
                    }
                }
            }, 10000);
        }
    };

    obj.settingsCapabilityResult = function (state, msg) {
        console.log('[omniossendlogs] settingsCapabilityResult received:', msg);
        if (!msg || !msg.data || !msg.data.nodeid) {
            console.log('[omniossendlogs] settingsCapabilityResult: invalid message structure');
            return;
        }

        pluginHandler.omniossendlogs.settingsCapability = pluginHandler.omniossendlogs.settingsCapability || {};
        pluginHandler.omniossendlogs.settingsCapability[msg.data.nodeid] = !!msg.data.supported;

        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === msg.data.nodeid) {
            pluginHandler.omniossendlogs.injectGeneral();
        }
    };

    obj.onDeviceRefreshEnd = function () {
        console.log('[omniossendlogs] onDeviceRefreshEnd called, currentNode:',
            (typeof currentNode !== 'undefined' && currentNode) ? currentNode._id : 'undefined');
        if (typeof meshserver === 'undefined') {
            console.log('[omniossendlogs] meshserver is undefined');
            return;
        }
        pluginHandler.omniossendlogs.exportStatus = pluginHandler.omniossendlogs.exportStatus || {};
        pluginHandler.omniossendlogs.injectGeneral();

        // Ask the agent (once per node) whether "Export Settings" is
        // supported, so the button starts disabled and only becomes
        // clickable once support is confirmed - see triggerExportSettings.
        pluginHandler.omniossendlogs.settingsCapability = pluginHandler.omniossendlogs.settingsCapability || {};
        pluginHandler.omniossendlogs.settingsCapabilityAsked = pluginHandler.omniossendlogs.settingsCapabilityAsked || {};
        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id) {
            var nid = currentNode._id;
            if (pluginHandler.omniossendlogs.settingsCapability[nid] === undefined && !pluginHandler.omniossendlogs.settingsCapabilityAsked[nid]) {
                pluginHandler.omniossendlogs.settingsCapabilityAsked[nid] = true;
                console.log('[omniossendlogs] Requesting settings capability check for node:', nid);
                meshserver.send({
                    action: 'plugin',
                    plugin: 'omniossendlogs',
                    pluginaction: 'checkSettingsCapability',
                    nodeid: nid
                });
            }
        }
    };

    // --- admin panel stub (not used) ---
    obj.handleAdminReq = function (req, res, user) { res.sendStatus(401); };
    obj.handleAdminPostReq = function (req, res, user) { res.sendStatus(401); };

    return obj;
};
