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
    
    // Client-side state (initialized when running in browser)
    obj.exportStatus = {}; // nodeid => { status, message, time }
    
    obj.exports = [
        'onDeviceRefreshEnd',
        'exportResult',
        'triggerExport',
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
                // Send immediate "running" status
                var runningMsg = {
                    action: 'plugin',
                    plugin: 'omniossendlogs',
                    method: 'exportResult',
                    data: { nodeid: nodeid, status: 'running', message: 'Export started...' }
                };
                obj.sendToSession(command.sessionid, myparent, runningMsg, grandparent);
                obj.queueSession(nodeid, command.sessionid);
                obj.requestExportFromAgent(nodeid);
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

        // Remove existing export row if present
        var existingRow = table.querySelector('#omniossendlogsTableRow');
        if (existingRow && existingRow.parentNode) {
            existingRow.parentNode.removeChild(existingRow);
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

        // Get current status
        var status = pluginHandler.omniossendlogs.exportStatus[currentNode._id] || null;
        var statusHtml = '';
        var linkStyle = '';
        
        if (status) {
            if (status.status === 'running') {
                statusHtml = ' <span style="color:#007bff;">⏳ Running...</span>';
                linkStyle = 'pointer-events:none;opacity:0.5;';
            } else if (status.status === 'success') {
                statusHtml = ' <span style="color:#28a745;">✓ ' + obj.escapeHtml(status.message) + '</span>';
            } else if (status.status === 'error') {
                statusHtml = ' <span style="color:#dc3545;">✗ ' + obj.escapeHtml(status.message) + '</span>';
            }
        }

        // Create the export row HTML
        var rowHtml = '<tr id="omniossendlogsTableRow"><td class="style7">Export</td><td class="style9">' +
            '<a href="#" style="' + linkStyle + '" onclick="pluginHandler.omniossendlogs.triggerExport(); return false;">Export Logs</a>' +
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
        var status = pluginHandler.omniossendlogs.exportStatus[currentNode._id];
        if (status && status.status === 'running') {
            console.log('[omniossendlogs] Export already running');
            return false;
        }
        
        // Set running status immediately for UI feedback
        pluginHandler.omniossendlogs.exportStatus[currentNode._id] = {
            status: 'running',
            message: 'Export started...',
            time: Date.now()
        };
        pluginHandler.omniossendlogs.injectGeneral();
        
        // Send request to server
        console.log('[omniossendlogs] Sending triggerExport request for node:', currentNode._id);
        meshserver.send({
            action: 'plugin',
            plugin: 'omniossendlogs',
            pluginaction: 'triggerExport',
            nodeid: currentNode._id
        });
        
        return false;
    };

    obj.exportResult = function (state, msg) {
        console.log('[omniossendlogs] exportResult received:', msg);
        if (!msg || !msg.data || !msg.data.nodeid) {
            console.log('[omniossendlogs] exportResult: invalid message structure');
            return;
        }
        
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
            setTimeout(function() {
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

    obj.onDeviceRefreshEnd = function () {
        console.log('[omniossendlogs] onDeviceRefreshEnd called, currentNode:', 
            (typeof currentNode !== 'undefined' && currentNode) ? currentNode._id : 'undefined');
        if (typeof meshserver === 'undefined') {
            console.log('[omniossendlogs] meshserver is undefined');
            return;
        }
        pluginHandler.omniossendlogs.exportStatus = pluginHandler.omniossendlogs.exportStatus || {};
        pluginHandler.omniossendlogs.injectGeneral();
    };

    // --- admin panel stub (not used) ---
    obj.handleAdminReq = function (req, res, user) { res.sendStatus(401); };
    obj.handleAdminPostReq = function (req, res, user) { res.sendStatus(401); };
    
    return obj;
};
