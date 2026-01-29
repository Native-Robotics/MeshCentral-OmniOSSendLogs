/**
* @description MeshCentral OmniOS Send Logs Plugin (web client-side)
*/

"use strict";

module.exports.omniossendlogs = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.sendInProgress = {}; // nodeid => boolean

    obj.exports = [
        'onDeviceRefreshEnd',
        'sendLogs',
        'sendLogsData',
        'injectGeneral'
    ];

    /**
     * Request send logs from the device
     */
    obj.sendLogs = function () {
        console.log('[omniossendlogs] sendLogs button clicked');
        
        if (typeof currentNode === 'undefined') {
            console.log('[omniossendlogs] currentNode is undefined');
            alert('No device selected');
            return;
        }
        
        var nodeid = currentNode._id;
        
        if (obj.sendInProgress[nodeid]) {
            console.log('[omniossendlogs] Send already in progress');
            alert('Send is already in progress');
            return;
        }
        
        obj.sendInProgress[nodeid] = true;
        console.log('[omniossendlogs] Requesting send for node: ' + nodeid);
        
        // Send request to server
        if (typeof meshserver !== 'undefined') {
            meshserver.send({
                action: 'plugin',
                plugin: 'omniossendlogs',
                pluginaction: 'requestSendLogs',
                nodeid: nodeid
            });
        } else {
            console.log('[omniossendlogs] meshserver undefined');
            obj.sendInProgress[nodeid] = false;
        }
    };

    /**
     * Handle send response from server
     */
    obj.sendLogsData = function (state, msg) {
        console.log('[omniossendlogs] sendLogsData received:', msg);
        
        if (!msg || !msg.nodeid) {
            console.log('[omniossendlogs] Invalid message structure');
            return;
        }
        
        var nodeid = msg.nodeid;
        obj.sendInProgress[nodeid] = false;
        
        // Update UI
        obj.injectGeneral();
        
        // Show result to user
        if (msg.success) {
            console.log('[omniossendlogs] Send successful');
            var resultText = 'Logs sent successfully';
            if (msg.result && msg.result.message) {
                resultText = msg.result.message;
            }
            if (msg.result && msg.result.timestamp) {
                resultText += '\nTime: ' + msg.result.timestamp;
            }
            alert(resultText);
        } else {
            console.log('[omniossendlogs] Send failed');
            var errorMsg = msg.error || 'Unknown error';
            alert('Failed to send logs:\n' + errorMsg);
        }
    };

    /**
     * Inject UI button into General tab
     */
    obj.injectGeneral = function () {
        if (typeof currentNode === 'undefined') {
            console.log('[omniossendlogs] currentNode is undefined');
            return;
        }
        
        var nodeid = currentNode._id;
        // Defensive check: ensure obj.sendInProgress exists
        var isInProgress = (obj.sendInProgress && obj.sendInProgress[nodeid]) || false;
        
        // Check if element already exists
        var existingButton = document.getElementById('gen_send_logs_button');
        if (existingButton) {
            // Update existing button
            if (isInProgress) {
                existingButton.textContent = 'Send logs to server (sending...)';
                existingButton.style.color = '#ff9900';
                existingButton.style.pointerEvents = 'none';
                existingButton.style.opacity = '0.6';
            } else {
                existingButton.textContent = 'Send logs to server';
                existingButton.style.color = '#0066cc';
                existingButton.style.pointerEvents = 'auto';
                existingButton.style.opacity = '1';
            }
            return;
        }
        
        // Create new button
        try {
            var appsDiv = document.getElementById('gen_apps');
            if (!appsDiv) {
                console.log('[omniossendlogs] gen_apps element not found');
                return;
            }
            
            var container = document.createElement('div');
            container.id = 'gen_send_logs_container';
            container.style.marginTop = '4px';
            
            var button = document.createElement('a');
            button.id = 'gen_send_logs_button';
            button.href = 'javascript:void(0)';
            button.textContent = 'Send logs to server';
            button.style.cursor = 'pointer';
            button.style.color = '#0066cc';
            button.style.textDecoration = 'none';
            button.style.display = 'inline-block';
            button.style.padding = '2px 0';
            button.onclick = function (e) {
                e.preventDefault();
                if (typeof pluginHandler !== 'undefined' && pluginHandler.omniossendlogs) {
                    pluginHandler.omniossendlogs.sendLogs();
                }
            };
            
            container.appendChild(button);
            appsDiv.parentNode.insertBefore(container, appsDiv.nextSibling);
            
            console.log('[omniossendlogs] UI injected successfully');
        } catch (e) {
            console.log('[omniossendlogs] Failed to inject UI: ' + e.message);
        }
    };

    /**
     * Called when device page is refreshed
     */
    obj.onDeviceRefreshEnd = function () {
        console.log('[omniossendlogs] onDeviceRefreshEnd called');
        if (typeof pluginHandler !== 'undefined' && pluginHandler.omniossendlogs) {
            pluginHandler.omniossendlogs.injectGeneral();
        }
    };

    return obj;
};
