/**
* @description MeshCentral OmniOS Send Logs Plugin (server-side)
*/

"use strict";

module.exports.omniosendlogs = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    
    obj.exports = [
        'requestSendLogs',
        'sendLogsData'
    ];

    /**
     * Request send logs (called from web client)
     */
    obj.requestSendLogs = function (nodeid, sessionid) {
        console.log('[omniosendlogs] requestSendLogs for node: ' + nodeid);
        
        if (!nodeid) return;
        
        // Send command to agent
        obj.meshServer.SendCommand({
            nodeid: nodeid,
            type: 'plugin',
            plugin: 'omniosendlogs',
            pluginaction: 'sendLogs'
        });
    };

    /**
     * Handle response from agent
     */
    obj.sendLogsData = function (state, msg) {
        if (!msg || !msg.sessionid) {
            console.log('[omniosendlogs] sendLogsData: invalid message');
            return;
        }
        
        console.log('[omniosendlogs] sendLogsData received: success=' + msg.success);
        
        // Forward response to web client
        try {
            if (obj.meshServer && obj.meshServer.wssessions2 && obj.meshServer.wssessions2[msg.sessionid]) {
                obj.meshServer.wssessions2[msg.sessionid].send(JSON.stringify({
                    action: 'plugin',
                    plugin: 'omniosendlogs',
                    pluginaction: 'sendLogsData',
                    success: msg.success,
                    result: msg.result,
                    error: msg.error
                }));
            }
        } catch (e) {
            console.log('[omniosendlogs] Failed to send response to client: ' + e.message);
        }
    };

    return obj;
};
