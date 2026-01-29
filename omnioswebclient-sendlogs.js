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

        try {
            if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) {
                console.log('[omniossendlogs] currentNode is undefined or invalid');
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
            obj.updateButtonState(nodeid);

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
                obj.updateButtonState(nodeid);
                alert('Server connection error');
            }
        } catch (e) {
            console.log('[omniossendlogs] Error in sendLogs: ' + e.message);
            obj.sendInProgress[nodeid] = false;
            alert('Error: ' + e.message);
        }
    };

    /**
     * Handle send response from server
     */
    obj.sendLogsData = function (state, msg) {
        console.log('[omniossendlogs] sendLogsData received:', msg);

        try {
            if (!msg || !msg.nodeid) {
                console.log('[omniossendlogs] Invalid message structure');
                return;
            }

            var nodeid = msg.nodeid;
            obj.sendInProgress[nodeid] = false;
            obj.updateButtonState(nodeid);

            // Show result to user
            if (msg.success) {
                console.log('[omniossendlogs] Send successful');
                var resultText = 'Logs sent successfully';
                if (msg.result && msg.result.message) {
                    resultText = msg.result.message;
                }
                if (msg.result && msg.result.timestamp) {
                    resultText += '\n\nTime: ' + msg.result.timestamp;
                }
                alert(resultText);
            } else {
                console.log('[omniossendlogs] Send failed');
                var errorMsg = msg.error || 'Unknown error';
                alert('Failed to send logs:\n\n' + errorMsg);
            }
        } catch (e) {
            console.log('[omniossendlogs] Error in sendLogsData: ' + e.message);
        }
    };

    /**
     * Update button visual state
     */
    obj.updateButtonState = function (nodeid) {
        try {
            var button = document.getElementById('gen_send_logs_button');
            if (!button) {
                console.log('[omniossendlogs] Button not found');
                return;
            }

            var isInProgress = (obj.sendInProgress && obj.sendInProgress[nodeid]) || false;

            if (isInProgress) {
                button.textContent = 'Send logs to server (sending...)';
                button.style.color = '#ff9900';
                button.style.pointerEvents = 'none';
                button.style.opacity = '0.6';
            } else {
                button.textContent = 'Send logs to server';
                button.style.color = '#0066cc';
                button.style.pointerEvents = 'auto';
                button.style.opacity = '1';
            }
        } catch (e) {
            console.log('[omniossendlogs] Error updating button: ' + e.message);
        }
    };

    /**
     * Inject UI button into General tab
     */
    obj.injectGeneral = function () {
        try {
            console.log('[omniossendlogs] injectGeneral called');

            // Defensive checks
            if (typeof currentNode === 'undefined' || !currentNode) {
                console.log('[omniossendlogs] currentNode is undefined, waiting...');
                return;
            }

            if (!currentNode._id) {
                console.log('[omniossendlogs] currentNode._id is undefined');
                return;
            }

            var nodeid = currentNode._id;
            console.log('[omniossendlogs] injectGeneral for node: ' + nodeid);

            // Check if button already exists
            var existingButton = document.getElementById('gen_send_logs_button');
            if (existingButton) {
                console.log('[omniossendlogs] Button already exists');
                return;
            }

            // Find the target element - look for gen_apps
            var appsDiv = document.getElementById('gen_apps');
            if (!appsDiv) {
                console.log('[omniossendlogs] gen_apps element not found');
                // Try alternative: look for any element with text "Apps"
                var allDivs = document.querySelectorAll('div');
                for (var i = 0; i < allDivs.length; i++) {
                    if (allDivs[i].textContent.indexOf('Apps') === 0 && allDivs[i].textContent.length < 20) {
                        appsDiv = allDivs[i];
                        console.log('[omniossendlogs] Found Apps element by text search');
                        break;
                    }
                }
            }

            if (!appsDiv) {
                console.log('[omniossendlogs] Could not find gen_apps or Apps element');
                return;
            }

            // Create button container
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

            button.onmouseenter = function () {
                this.style.textDecoration = 'underline';
            };
            button.onmouseleave = function () {
                this.style.textDecoration = 'none';
            };

            button.onclick = function (e) {
                e.preventDefault();
                obj.sendLogs();
            };

            container.appendChild(button);

            // Insert after appsDiv
            if (appsDiv.nextSibling) {
                appsDiv.parentNode.insertBefore(container, appsDiv.nextSibling);
            } else {
                appsDiv.parentNode.appendChild(container);
            }

            console.log('[omniossendlogs] UI injected successfully');

        } catch (e) {
            console.log('[omniossendlogs] Failed to inject UI: ' + e.message);
            console.log('[omniossendlogs] Stack: ' + e.stack);
        }
    };

    /**
     * Called when device page is refreshed or loaded
     */
    obj.onDeviceRefreshEnd = function () {
        console.log('[omniossendlogs] onDeviceRefreshEnd called');

        // Try to inject immediately
        obj.injectGeneral();

        // If injection failed, retry after a short delay (DOM might not be ready)
        setTimeout(function () {
            if (!document.getElementById('gen_send_logs_button')) {
                console.log('[omniossendlogs] Retrying injection after delay');
                obj.injectGeneral();
            }
        }, 500);

        // Additional retry after longer delay
        setTimeout(function () {
            if (!document.getElementById('gen_send_logs_button')) {
                console.log('[omniossendlogs] Final retry of injection');
                obj.injectGeneral();
            }
        }, 1500);
    };

    return obj;
};