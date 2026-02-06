/**
 * @description MeshCentral Log Exporter plugin (agent side)
 * Executes export command and reports result to server.
 */

"use strict";
var mesh;
var _sessionid;
var isWsconnection = false;
var wscon = null;

// Command to execute for log export - direct python call
var PYTHON_BIN = '/usr/bin/python3';
var EXPORT_SCRIPT = '/home/user/launchpad/pages/data/export_data.py';
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

    // Check if python script exists
    try {
        if (!fs.existsSync(EXPORT_SCRIPT)) {
            dbg('Export script not found: ' + EXPORT_SCRIPT);
            sendResult(false, 'Script not found: ' + EXPORT_SCRIPT);
            return;
        }
    } catch (e) {
        dbg('Error checking script existence: ' + e.toString());
        sendResult(false, 'Error checking script: ' + e.toString());
        return;
    }

    dbg('Executing: ' + PYTHON_BIN + ' ' + EXPORT_SCRIPT + ' --mode server (cwd: ' + EXPORT_CWD + ')');

    try {
        // Create custom environment with HOME set to /home/user
        var customEnv = {};
        for (var key in process.env) {
            customEnv[key] = process.env[key];
        }
        customEnv['HOME'] = '/home/user';
        var username = 'user';
        var cmdParts = [];

        // 1. Change directory
        cmdParts.push('cd ' + EXPORT_CWD);

        // Read SERIAL from personal_config.sh
        // 2. Read SERIAL from personal_config.sh and export it
        try {
            var configBuffer = fs.readFileSync('/home/user/keys/personal_config.sh');
            // Convert buffer to string (MeshAgent returns Uint8Array)
            var configContent = (typeof configBuffer === 'string') ? configBuffer : String.fromCharCode.apply(null, configBuffer);
            var serialMatch = configContent.match(/SERIAL=(\S+)/);
            if (serialMatch && serialMatch[1]) {
                customEnv['SERIAL'] = serialMatch[1];
                cmdParts.push('export SERIAL=\'' + serialMatch[1] + '\'');
                dbg('SERIAL set to: ' + serialMatch[1]);
            } else {
                dbg('Warning: SERIAL not found in personal_config.sh');
            }
        } catch (e) {
            dbg('Warning: Could not read SERIAL from personal_config.sh: ' + e.toString());
        }

        // Set PYTHONPATH to include libs directory
        var pythonPath = '/home/user/launchpad/libs';
        if (customEnv['PYTHONPATH']) {
            pythonPath = pythonPath + ':' + customEnv['PYTHONPATH'];
        }
        customEnv['PYTHONPATH'] = pythonPath;
        dbg('PYTHONPATH set to: ' + pythonPath);
        // 3. Set PYTHONPATH
        cmdParts.push('export PYTHONPATH=$PYTHONPATH:/home/user/launchpad/libs');

        var options = {
            env: customEnv,  // Use custom environment with HOME, SERIAL, PYTHONPATH
            cwd: EXPORT_CWD  // Set working directory
        };
        // 4. Run python script
        cmdParts.push(PYTHON_BIN + ' ' + EXPORT_SCRIPT + ' --mode server');

        // Use /bin/sh -c to run command - MeshAgent only supports execFile
        var fullCmd = PYTHON_BIN + ' ' + EXPORT_SCRIPT + ' --mode server';
        dbg('Full command: ' + fullCmd);
        var proc = childProcess.execFile('/bin/sh', ['-c', fullCmd], options);
        var fullCmd = cmdParts.join(' && ');
        dbg('Executing via su - ' + username + ': ' + fullCmd);

        var options = { maxBuffer: 1024 * 1024 };
        var proc = childProcess.execFile('/bin/su', ['-', username, '-c', fullCmd], options);
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

    // Prefer sending via mesh object if available (context-aware)
    var sent = false;
    if (mesh && typeof mesh.SendCommand === 'function') {
        try {
            dbg('Sending via mesh.SendCommand');
            mesh.SendCommand(response);
            sent = true;
        } catch (e) {
            dbg('Error sending via mesh.SendCommand: ' + e.toString());
        }
    }

    if (!sent) {
        dbg('Sending via MeshAgent.SendCommand');
        try {
            require('MeshAgent').SendCommand(response);
        } catch (e) {
            dbg('Error sending via MeshAgent.SendCommand: ' + e.toString());
        }
    }
}

module.exports = { consoleaction: consoleaction };
