/**
 * @description MeshCentral Log Exporter plugin (agent side)
 * Executes export command and reports result to server.
 */

"use strict";
var mesh;
var _sessionid;
var isWsconnection = false;
var wscon = null;

// Command to execute for log export
var EXPORT_CMD = '/home/user/.local/bin/export_data --mode server';
var EXPORT_CWD = '/home/user/launchpad';  // Working directory for export script

function dbg(msg) {
    try {
        require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: '[omniossendlogs-agent] ' + msg });
    } catch (e) { }
}

function consoleaction(args, rights, sessionid, parent) {
    isWsconnection = false;
    wscon = parent;
    _sessionid = sessionid;

    // Safe check and initialization of args['_']
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
        case 'runExport':
            dbg('runExport action called');
            runExportCommand();
            break;
        default:
            dbg('Unknown action: ' + fnname);
            break;
    }
}

function runExportCommand() {
    dbg('runExportCommand called');

    var childProcess = require('child_process');
    var fs = require('fs');

    // Check if command exists
    try {
        if (!fs.existsSync(EXPORT_CMD)) {
            dbg('Export command not found: ' + EXPORT_CMD);
            sendResult(false, 'Command not found: ' + EXPORT_CMD);
            return;
        }
    } catch (e) {
        dbg('Error checking command existence: ' + e.toString());
        sendResult(false, 'Error checking command: ' + e.toString());
        return;
    }

    dbg('Executing: ' + EXPORT_CMD + ' (cwd: ' + EXPORT_CWD + ')');

    try {
        // Create custom environment with HOME set to /home/user
        var customEnv = {};
        for (var key in process.env) {
            customEnv[key] = process.env[key];
        }
        customEnv['HOME'] = '/home/user';

        var options = {
            env: customEnv,  // Use custom environment with HOME override
            cwd: EXPORT_CWD  // Set working directory
        };

        // Use execFile with bash -c to ensure proper argument handling
        var proc = childProcess.execFile('/bin/bash', ['-c', EXPORT_CMD], options);
        var stdout = '';
        var stderr = '';

        proc.stdout.on('data', function (chunk) {
            stdout += chunk.toString();
            dbg('stdout: ' + chunk.toString().trim());
        });

        proc.stderr.on('data', function (chunk) {
            stderr += chunk.toString();
            dbg('stderr: ' + chunk.toString().trim());
        });

        proc.on('exit', function (code) {
            dbg('Process exited with code: ' + code);
            if (code === 0) {
                sendResult(true, 'Export completed successfully');
            } else {
                var errMsg = stderr.trim() || stdout.trim() || 'Exit code: ' + code;
                sendResult(false, 'Export failed: ' + errMsg);
            }
        });

        proc.on('error', function (err) {
            dbg('Process error: ' + err.toString());
            sendResult(false, 'Process error: ' + err.toString());
        });

    } catch (e) {
        dbg('Exception running command: ' + e.toString());
        sendResult(false, 'Exception: ' + e.toString());
    }
}

function sendResult(success, message) {
    dbg('sendResult: success=' + success + ', message=' + message);
    var response = {
        action: 'plugin',
        plugin: 'omniossendlogs',
        pluginaction: 'exportResult',
        success: success,
        message: message
    };

    // Always use MeshAgent.SendCommand for plugin communication
    // The wscon object doesn't have a direct send() method for plugins
    dbg('Sending via MeshAgent');
    try {
        require('MeshAgent').SendCommand(response);
    } catch (e) {
        dbg('Error sending via MeshAgent: ' + e.toString());
        // Fallback: try sending through mesh parent if available
        if (mesh && typeof mesh.SendCommand === 'function') {
            try {
                dbg('Fallback: Sending via mesh.SendCommand');
                mesh.SendCommand(response);
            } catch (e2) {
                dbg('Fallback also failed: ' + e2.toString());
            }
        }
    }
}

module.exports = { consoleaction: consoleaction };
