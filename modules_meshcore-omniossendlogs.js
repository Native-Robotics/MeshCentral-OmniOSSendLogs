/**
* @description MeshCentral OmniOS Send Logs Plugin (agent-side)
*/

"use strict";

var mesh;
var _sessionid;
var isWsconnection = false;
var wscon = null;
var db = require('SimpleDataStore').Shared();
var fs = require('fs');
var childProcess = require('child_process');

var LAUNCHPAD_PATH = '/home/user/launchpad';
var EXPORT_COMMAND = 'export_data';
var EXPORT_MODE = 'server';

function dbg(msg) {
    try {
        require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: '[omniossendlogs-agent] ' + msg });
    } catch (e) { }
}

function consoleaction(args, rights, sessionid, parent) {
    isWsconnection = false;
    wscon = parent;
    _sessionid = sessionid;
    
    // Safe initialization of args['_']
    if (typeof args['_'] == 'undefined') {
        args['_'] = [];
        args['_'][1] = args.pluginaction;
        args['_'][2] = null;
        args['_'][3] = null;
        args['_'][4] = null;
        isWsconnection = true;
    }

    var fnname = args['_'][1];
    mesh = parent;
    
    dbg('consoleaction called with action: ' + fnname);

    switch (fnname) {
        case 'sendLogs':
            dbg('sendLogs action called');
            executeSendLogs();
            break;
        default:
            dbg('Unknown action: ' + fnname);
            break;
    }
}

/**
 * Execute export_data command
 */
function executeSendLogs() {
    dbg('executeSendLogs: starting export_data command');
    
    // Check if launchpad directory exists
    if (!fs.existsSync(LAUNCHPAD_PATH)) {
        dbg('ERROR: Launchpad path does not exist: ' + LAUNCHPAD_PATH);
        sendLogsResponse(false, null, 'Launchpad directory not found: ' + LAUNCHPAD_PATH);
        return;
    }
    
    dbg('Launchpad path exists: ' + LAUNCHPAD_PATH);
    
    // Build command
    var cmd = EXPORT_COMMAND + ' --mode ' + EXPORT_MODE;
    
    dbg('Executing command: ' + cmd + ' in directory: ' + LAUNCHPAD_PATH);
    
    try {
        // Execute command with cwd set to launchpad directory
        var proc = childProcess.execFile('/bin/sh', ['-c', cmd], {
            cwd: LAUNCHPAD_PATH,
            timeout: 60000, // 60 second timeout
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        }, function (error, stdout, stderr) {
            if (error) {
                dbg('ERROR executing command: ' + error.message);
                dbg('stderr: ' + stderr);
                sendLogsResponse(false, null, 'Command execution failed: ' + error.message);
                return;
            }
            
            dbg('Command executed successfully');
            dbg('stdout length: ' + stdout.length + ' bytes');
            dbg('stderr: ' + stderr);
            
            // Success case
            sendLogsResponse(true, {
                message: 'Logs sent successfully',
                output_size: stdout.length,
                timestamp: new Date().toISOString()
            }, null);
        });
        
    } catch (e) {
        dbg('ERROR: Exception during command execution: ' + e.message);
        sendLogsResponse(false, null, 'Exception: ' + e.message);
    }
}

/**
 * Send export response back to server
 */
function sendLogsResponse(success, data, error) {
    dbg('sendLogsResponse: success=' + success);
    
    try {
        var msg = {
            action: 'plugin',
            plugin: 'omniossendlogs',
            pluginaction: 'sendLogsData',
            sessionid: _sessionid,
            tag: 'console',
            success: success,
            result: data,
            error: error
        };
        
        if (isWsconnection) {
            wscon.send(JSON.stringify(msg));
            dbg('Response sent via WebSocket');
        } else {
            mesh.SendCommand(msg);
            dbg('Response sent via mesh');
        }
    } catch (e) {
        dbg('ERROR: Failed to send response: ' + e.message);
    }
}

// Export function for MeshCentral
exports.consoleaction = consoleaction;