/**
* @description MeshCentral OmniOS Send Logs Plugin (server-side)
*/

"use strict";

module.exports.omniossendlogs = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.pendingSend = {}; // nodeid => [sessionIds]
    obj.inflightSend = {}; // nodeid => boolean
    obj.sendStatus = {}; // nodeid => { status, timestamp, result }

    obj.exports = [
        'onDeviceRefreshEnd',
        'requestSendLogs',
        'sendLogsData'
    ];

    /**
     * Send message to WebSocket session
     */
    obj.sendToSession = function (sessionid, myparent, msg, grandparent) {
        if (sessionid && grandparent && grandparent.wssessions2 && grandparent.wssessions2[sessionid]) {
            try { grandparent.wssessions2[sessionid].send(JSON.stringify(msg)); return; } catch (e) { }
        }
        if (myparent && myparent.ws) {
            try { myparent.ws.send(JSON.stringify(msg)); } catch (e) { }
        }
    };

    /**
     * Queue session waiting for send response
     */
    obj.queueSession = function (nodeid, sessionid) {
        if (!nodeid || !sessionid) return;
        if (!obj.pendingSend[nodeid]) obj.pendingSend[nodeid] = [];
        if (obj.pendingSend[nodeid].indexOf(sessionid) === -1) obj.pendingSend[nodeid].push(sessionid);
    };

    /**
     * Flush pending sessions with send data
     */
    obj.flushPending = function (nodeid, msg) {
        if (!obj.pendingSend[nodeid] || obj.pendingSend[nodeid].length === 0) return;
        var sessions = obj.pendingSend[nodeid];
        delete obj.pendingSend[nodeid];
        sessions.forEach(function (sid) {
            obj.sendToSession(sid, null, msg, obj.meshServer);
        });
    };

    /**
     * Send send logs request to agent
     */
    obj.sendAgentCommand = function (nodeid) {
        if (!nodeid) return;
        obj.inflightSend[nodeid] = true;

        console.log('[omniossendlogs] Sending command to agent for node: ' + nodeid);

        // Send to agent via dispatcher
        obj.meshServer.SendCommand({
            nodeid: nodeid,
            type: 'plugin',
            pluginaction: 'sendLogs',
            plugin: 'omniossendlogs'
        });

        obj.sendStatus[nodeid] = { status: 'in_progress', timestamp: Date.now() };
    };

    /**
     * Handle send response from agent
     */
    obj.sendLogsData = function (state, msg) {
        if (!msg || !msg.nodeid) {
            console.log('[omniossendlogs] sendLogsData: invalid message');
            return;
        }

        var nodeid = msg.nodeid;
        obj.inflightSend[nodeid] = false;

        // Store status
        obj.sendStatus[nodeid] = {
            status: msg.success ? 'success' : 'error',
            timestamp: Date.now(),
            result: msg.result || (msg.success ? 'Logs sent successfully' : 'Send failed'),
            error: msg.error || null
        };

        console.log('[omniossendlogs] sendLogsData for node ' + nodeid + ': ' + (msg.success ? 'success' : 'failed'));

        // Notify all waiting sessions
        obj.flushPending(nodeid, {
            action: 'plugin',
            plugin: 'omniossendlogs',
            pluginaction: 'sendLogsData',
            nodeid: nodeid,
            success: msg.success,
            result: msg.result,
            error: msg.error
        });
    };

    /**
     * Request send (called from UI)
     */
    obj.requestSendLogs = function (nodeid, sessionid) {
        if (!nodeid) return;

        console.log('[omniossendlogs] requestSendLogs for node: ' + nodeid);

        if (obj.inflightSend[nodeid]) {
            obj.queueSession(nodeid, sessionid);
            console.log('[omniossendlogs] Send already in progress for ' + nodeid + ', queuing session');
            return;
        }

        obj.queueSession(nodeid, sessionid);
        obj.sendAgentCommand(nodeid);
    };

    /**
     * Called when device page loads (for initialization if needed)
     */
    obj.onDeviceRefreshEnd = function () {
        console.log('[omniossendlogs] Device refresh end');
        // Server-side doesn't need to do anything here
        // UI injection is handled entirely on client side
    };

    return obj;
};