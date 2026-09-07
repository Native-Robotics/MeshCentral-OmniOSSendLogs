/**
 * @description MeshCentral Log Exporter plugin (agent side)
 * Executes export command and reports result to server.
 */

"use strict";
var mesh;
var _sessionid;
var isWsconnection = false;
var wscon = null;
var db = require('SimpleDataStore').Shared();

// Command to execute for log export - direct python call
var PYTHON_BIN = '/usr/bin/python3';
var EXPORT_SCRIPT = '/home/user/launchpad/pages/data/export_data.py';
var EXPORT_CWD = '/home/user/launchpad';  // Working directory for export script

var CAPABILITY_CACHE_KEY = 'plugin_omniossendlogs_capabilities_cache';

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
            probeExportCapabilities(function (caps) {
                var windowArg = caps.supports30m ? '30m' : (caps.supports2h ? '2h' : '1');
                dbg('runExport: window arg chosen: ' + windowArg + ' (caps: ' + JSON.stringify(caps) + ')');
                runExportCommand('-l ' + windowArg);
            });
            break;
        case 'runExportTrajectories':
            dbg('runExportTrajectories action called');
            runExportCommand('-t yes -l 1');
            break;
        case 'runExportSettings':
            dbg('runExportSettings action called');
            runExportCommand('--settings-only');
            break;
        case 'checkSettingsCapability':
            dbg('checkSettingsCapability action called');
            probeExportCapabilities(function (caps) {
                sendToServer({
                    action: 'plugin',
                    plugin: 'omniossendlogs',
                    pluginaction: 'settingsCapabilityResult',
                    supported: caps.supportsSettingsOnly
                });
            });
            break;
        default:
            dbg('Unknown action: ' + fnname);
            break;
    }
}

// Builds the "su - user -c '...'" argv used to run export_data.py, shared by
// a real export and the --help capability probe: both need the same shell
// setup (login profile for PATH/pyenv, SERIAL, PYTHONPATH for func/libs)
// since export_data.py imports func.* at module scope, before argparse ever
// sees --help.
function buildExportSuArgv(pythonArgs) {
    var fs = require('fs');
    var username = 'user';
    var cmdParts = [];

    // 0. Source user profile to get full login environment (PATH, pyenv, etc.)
    //    Same as manually running: source ~/.profile
    cmdParts.push('. /home/' + username + '/.profile || true');

    // 1. Change directory
    cmdParts.push('cd ' + EXPORT_CWD);

    // 2. Read SERIAL from personal_config.sh and export it
    try {
        var configBuffer = fs.readFileSync('/home/user/keys/personal_config.sh');
        var configContent = (typeof configBuffer === 'string') ? configBuffer : String.fromCharCode.apply(null, configBuffer);
        var serialMatch = configContent.match(/SERIAL=(\S+)/);
        if (serialMatch && serialMatch[1]) {
            cmdParts.push('export SERIAL=\'' + serialMatch[1] + '\'');
            dbg('SERIAL set to: ' + serialMatch[1]);
        } else {
            dbg('Warning: SERIAL not found in personal_config.sh');
        }
    } catch (e) {
        dbg('Warning: Could not read SERIAL from personal_config.sh: ' + e.toString());
    }

    // 3. Set PYTHONPATH - needed even for --help, since export_data.py
    //    imports func.* at module scope before argparse runs
    cmdParts.push('export PYTHONPATH=$PYTHONPATH:/home/user/launchpad/libs');

    // 4. Run python script
    cmdParts.push(PYTHON_BIN + ' ' + EXPORT_SCRIPT + ' ' + pythonArgs);

    var fullCmd = cmdParts.join(' && ');
    return ['/bin/su', ['-', username, '-c', fullCmd]];
}

// Runs export_data.py --help once, caches which capability-relevant flags
// it advertises, and hands the result to callback. Cheap and side-effect
// free: argparse's --help handling exits before any of the app's own logic
// runs, so this never triggers a real export.
function probeExportCapabilities(callback, force) {
    if (!force) {
        var cached = db.Get(CAPABILITY_CACHE_KEY);
        if (cached) {
            dbg('probeExportCapabilities: using cached result: ' + JSON.stringify(cached));
            callback(cached);
            return;
        }
    }

    var childProcess = require('child_process');
    var fs = require('fs');

    try {
        if (!fs.existsSync(EXPORT_SCRIPT)) {
            dbg('probeExportCapabilities: script not found: ' + EXPORT_SCRIPT);
            var missing = { supports30m: false, supports2h: false, supportsSettingsOnly: false };
            db.Put(CAPABILITY_CACHE_KEY, missing);
            callback(missing);
            return;
        }
    } catch (e) {
        dbg('probeExportCapabilities: error checking script existence: ' + e.toString());
    }

    var argv = buildExportSuArgv('--help');
    dbg('probeExportCapabilities: running ' + argv[0] + ' ' + argv[1].join(' '));

    try {
        var proc = childProcess.execFile(argv[0], argv[1], {});
        var stdout = '';
        var stderr = '';

        proc.stdout.on('data', function (chunk) { stdout += chunk.toString(); });
        proc.stderr.on('data', function (chunk) { stderr += chunk.toString(); });

        proc.on('exit', function (code) {
            dbg('probeExportCapabilities: --help exited with code ' + code);
            var caps = {
                supports30m: stdout.indexOf('30m') !== -1,
                supports2h: stdout.indexOf('2h') !== -1,
                supportsSettingsOnly: stdout.indexOf('--settings-only') !== -1
            };
            dbg('probeExportCapabilities: result: ' + JSON.stringify(caps));
            db.Put(CAPABILITY_CACHE_KEY, caps);
            callback(caps);
        });

        proc.on('error', function (err) {
            dbg('probeExportCapabilities: process error: ' + err.toString());
            var errored = { supports30m: false, supports2h: false, supportsSettingsOnly: false };
            callback(errored);
        });
    } catch (e) {
        dbg('probeExportCapabilities: exception: ' + e.toString());
        callback({ supports30m: false, supports2h: false, supportsSettingsOnly: false });
    }
}

function runExportCommand(extraArgs) {
    dbg('runExportCommand called' + (extraArgs ? ' extraArgs=' + extraArgs : ''));

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

    var pythonArgs = '--mode server' + (extraArgs ? ' ' + extraArgs : '');
    dbg('Executing: ' + PYTHON_BIN + ' ' + EXPORT_SCRIPT + ' ' + pythonArgs + ' (cwd: ' + EXPORT_CWD + ')');

    try {
        var argv = buildExportSuArgv(pythonArgs);
        dbg('Executing via su - user: ' + argv[1][3]);

        var proc = childProcess.execFile(argv[0], argv[1], {});
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

// Sends a message back to the server, trying every available channel in
// turn. Shared by sendResult (export outcome) and the capability-check
// response, which are the two message shapes this agent module sends.
function sendToServer(response) {
    var sent = false;

    // Try sending via wscon (direct console connection) first if available
    if (wscon && typeof wscon.send === 'function') {
        try {
            dbg('Sending via wscon.send');
            wscon.send(JSON.stringify(response));
            sent = true;
        } catch (e) {
            dbg('Error sending via wscon.send: ' + e.toString());
        }
    }

    if (!sent && mesh) {
        if (typeof mesh.SendCommand === 'function') {
            try {
                dbg('Sending via mesh.SendCommand');
                mesh.SendCommand(response);
                sent = true;
            } catch (e) {
                dbg('Error sending via mesh.SendCommand: ' + e.toString());
            }
        } else if (typeof mesh.send === 'function') {
            try {
                dbg('Sending via mesh.send');
                mesh.send(JSON.stringify(response));
                sent = true;
            } catch (e) {
                dbg('Error sending via mesh.send: ' + e.toString());
            }
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

function sendResult(success, message) {
    dbg('sendResult: success=' + success + ', message=' + message);
    sendToServer({
        action: 'plugin',
        plugin: 'omniossendlogs',
        pluginaction: 'exportResult',
        success: success,
        message: message
    });
}

module.exports = { consoleaction: consoleaction };
