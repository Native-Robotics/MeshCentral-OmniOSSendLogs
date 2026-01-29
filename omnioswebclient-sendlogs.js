/**
* @description MeshCentral OmniOS Send Logs Plugin (web client-side)
*/

"use strict";

module.exports.omniosendlogs = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;

    obj.exports = [
        'injectGeneral',
        'requestSendLogs',
        'sendLogsData'
    ];

    /**
     * Inject "Send logs to server" link after Apps section in General tab
     */
    obj.injectGeneral = function () {
        try {
            // Make sure we're on a valid page with a device
            if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) {
                return;
            }
            
            var nodeid = currentNode._id;
            console.log('[omniosendlogs] injectGeneral for node: ' + nodeid);
            
            // Look for the Apps display element
            var appsElement = document.querySelector('[data-type="apps"]');
            if (!appsElement) {
                // Alternative: look for element containing "Apps:"
                var allElements = document.querySelectorAll('*');
                for (var i = 0; i < allElements.length; i++) {
                    if (allElements[i].textContent.trim().startsWith('Apps:')) {
                        appsElement = allElements[i];
                        break;
                    }
                }
            }
            
            if (!appsElement || !appsElement.parentNode) {
                console.log('[omniosendlogs] Apps element not found in DOM');
                return;
            }
            
            // Check if we already injected the button
            if (document.getElementById('omniosendlogs_button')) {
                console.log('[omniosendlogs] Button already injected');
                return;
            }
            
            // Create link element
            var link = document.createElement('a');
            link.id = 'omniosendlogs_button';
            link.href = 'javascript:void(0)';
            link.textContent = 'Send logs to server';
            link.style.color = '#0066cc';
            link.style.textDecoration = 'none';
            link.style.cursor = 'pointer';
            link.style.marginLeft = '8px';
            
            // Add hover effect
            link.onmouseover = function() { this.style.textDecoration = 'underline'; };
            link.onmouseout = function() { this.style.textDecoration = 'none'; };
            
            // Handle click
            link.onclick = function (e) {
                e.preventDefault();
                obj.requestSendLogs();
            };
            
            // Insert link after Apps element (in same line or next line)
            var container = document.createElement('span');
            container.style.marginLeft = '8px';
            container.appendChild(link);
            
            // Try to insert in the same parent element
            if (appsElement.nextSibling) {
                appsElement.parentNode.insertBefore(container, appsElement.nextSibling);
            } else {
                appsElement.parentNode.appendChild(container);
            }
            
            console.log('[omniosendlogs] UI injected successfully');
            
        } catch (e) {
            console.log('[omniosendlogs] Failed to inject UI: ' + e.message);
        }
    };

    /**
     * Request to send logs
     */
    obj.requestSendLogs = function () {
        console.log('[omniosendlogs] Send logs button clicked');
        
        try {
            if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) {
                alert('No device selected');
                return;
            }
            
            var nodeid = currentNode._id;
            var button = document.getElementById('omniosendlogs_button');
            
            // Show progress
            if (button) {
                button.textContent = 'Send logs to server (sending...)';
                button.style.color = '#ff9900';
                button.style.pointerEvents = 'none';
            }
            
            console.log('[omniosendlogs] Requesting send for node: ' + nodeid);
            
            // Send request to server
            if (typeof meshserver !== 'undefined') {
                meshserver.send({
                    action: 'plugin',
                    plugin: 'omniosendlogs',
                    pluginaction: 'requestSendLogs',
                    nodeid: nodeid
                });
            } else {
                alert('Server connection error');
                if (button) {
                    button.textContent = 'Send logs to server';
                    button.style.color = '#0066cc';
                    button.style.pointerEvents = 'auto';
                }
            }
        } catch (e) {
            console.log('[omniosendlogs] Error: ' + e.message);
            alert('Error: ' + e.message);
        }
    };

    /**
     * Handle response from server
     */
    obj.sendLogsData = function (state, msg) {
        console.log('[omniosendlogs] sendLogsData received:', msg);
        
        try {
            var button = document.getElementById('omniosendlogs_button');
            
            // Restore button state
            if (button) {
                button.textContent = 'Send logs to server';
                button.style.color = '#0066cc';
                button.style.pointerEvents = 'auto';
            }
            
            // Show result to user
            if (msg && msg.success) {
                console.log('[omniosendlogs] Send successful');
                var resultText = 'Logs sent successfully';
                if (msg.result && msg.result.message) {
                    resultText = msg.result.message;
                }
                if (msg.result && msg.result.timestamp) {
                    resultText += '\nTime: ' + msg.result.timestamp;
                }
                alert(resultText);
            } else {
                console.log('[omniosendlogs] Send failed');
                var errorMsg = (msg && msg.error) ? msg.error : 'Unknown error';
                alert('Failed to send logs:\n' + errorMsg);
            }
        } catch (e) {
            console.log('[omniosendlogs] Error in sendLogsData: ' + e.message);
        }
    };

    return obj;
};
