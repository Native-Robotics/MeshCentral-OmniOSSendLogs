/**
* @description MeshCentral OmniOS Send Logs Plugin (agent-side)
*/

"use strict";

var mesh;
var db = require('SimpleDataStore').Shared();
var fs = require('fs');
var childProcess = require('child_process');

var LAUNCHPAD_PATH = '/home/user/launchpad';
var EXPORT_COMMAND = '/home/user/.local/bin/export_data';
var EXPORT_MODE = 'server';

function dbg(msg) {
    try {
        require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: '[omniosendlogs-agent] ' + msg });
    } catch (e) { }
}

function consoleaction(args, rights, sessionid, parent) {
    var fnname = args['_'][1];
    mesh = parent;
    
    dbg('consoleaction called with action: ' + fnname);

    switch (fnname) {
        case 'sendLogs':
            dbg('sendLogs action called');
            executeSendLogs(parent, sessionid);
            break;
        default:
            dbg('Unknown action: ' + fnname);
            break;
    }
}

/**
 * Execute export_data command from launchpad directory
 */
function executeSendLogs(mesh, sessionid) {
    dbg('executeSendLogs: starting export_data command');
    
    // Check if launchpad directory exists
    if (!fs.existsSync(LAUNCHPAD_PATH)) {
        dbg('ERROR: Launchpad path does not exist: ' + LAUNCHPAD_PATH);
        sendResponse(mesh, sessionid, false, null, 'Launchpad directory not found: ' + LAUNCHPAD_PATH);
        return;
    }
    
    // Check if export_data exists
    if (!fs.existsSync(EXPORT_COMMAND)) {
        dbg('ERROR: export_data command not found: ' + EXPORT_COMMAND);
        sendResponse(mesh, sessionid, false, null, 'export_data command not found: ' + EXPORT_COMMAND);
        return;
    }
    
    dbg('Launchpad path exists: ' + LAUNCHPAD_PATH);
    dbg('export_data exists: ' + EXPORT_COMMAND);
    
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
                if (stderr) dbg('stderr: ' + stderr);
                sendResponse(mesh, sessionid, false, null, 'Command execution failed: ' + error.message);
                return;
            }
            
            dbg('Command executed successfully');
            dbg('stdout length: ' + stdout.length + ' bytes');
            if (stderr) dbg('stderr: ' + stderr);
            
            // Success case
            sendResponse(mesh, sessionid, true, {
                message: 'Logs sent successfully',
                output_size: stdout.length,
                timestamp: new Date().toISOString()
            }, null);
        });
        
    } catch (e) {
        dbg('ERROR: Exception during command execution: ' + e.message);
        sendResponse(mesh, sessionid, false, null, 'Exception: ' + e.message);
    }
}

/**
 * Send response back to server
 */
function sendResponse(mesh, sessionid, success, data, error) {
    dbg('sendResponse: success=' + success);
    
    try {
        var msg = {
            action: 'plugin',
            plugin: 'omniosendlogs',
            pluginaction: 'sendLogsData',
            sessionid: sessionid,
            success: success,
            result: data,
            error: error
        };
        
        mesh.SendCommand(msg);
        dbg('Response sent to server');
    } catch (e) {
        dbg('ERROR: Failed to send response: ' + e.message);
    }
}

// Export function for MeshCentral
exports.consoleaction = consoleaction;
