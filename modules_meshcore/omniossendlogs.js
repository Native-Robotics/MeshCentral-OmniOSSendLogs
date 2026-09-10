/** MeshCentral OmniOS export agent. Runs named Launchpad operations. */
"use strict";
var db = require('SimpleDataStore').Shared();
var PYTHON_BIN = '/usr/bin/python3';
var EXPORT_SCRIPT = '/home/user/launchpad/pages/data/export_data.py';
var EXPORT_CWD = '/home/user/launchpad';
var CAPABILITY_CACHE_KEY = 'plugin_omniossendlogs_capabilities_cache';
var CAPABILITY_TTL_MS = 5 * 60 * 1000;
var probeWaiters = null;
var exportBusy = false;

function dbg(message) {
    try { require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: '[omniossendlogs-agent] ' + message }); } catch (e) { }
}

function consoleaction(args, rights, sessionid, parent) {
    var action = args.pluginaction || (args['_'] && args['_'][1]);
    var requestId = typeof args.requestId === 'string' ? args.requestId : undefined;
    function reply(resultAction, data) {
        data.action = 'plugin';
        data.plugin = 'omniossendlogs';
        data.pluginaction = resultAction;
        data.requestId = requestId;
        data.sessionid = sessionid;
        try { parent.SendCommand(data); } catch (e) { dbg('Reply failed: ' + e); }
    }
    if (action === 'checkExportCapabilities') {
        probeExportCapabilities(function (caps, error) {
            reply('exportCapabilitiesResult', error ? { error: error } : {
                settingsOnly: caps.supportsSettingsOnly, arbitraryWindow: caps.supportsArbitraryWindow
            });
        }, args.force === true);
        return;
    }
    if (['runExport', 'runExportTrajectories', 'runExportSettings'].indexOf(action) === -1) return;
    // routeToNode also reaches this handler; view-only access cannot run commands.
    if (typeof rights !== 'number' || (rights & 16) === 0) {
        reply('exportResult', { success: false, message: 'Access denied: Agent Console permission required' });
        return;
    }
    if (exportBusy) {
        reply('exportResult', { success: false, message: 'Another export is still running on this device' });
        return;
    }
    exportBusy = true;
    function finish(error) {
        exportBusy = false;
        reply('exportResult', { success: !error, message: error || 'Export completed successfully' });
    }
    function run(extraArgs) {
        dbg('Export arguments: ' + extraArgs);
        runPython('--mode server ' + extraArgs, 0, function (stdout, error) { finish(error); });
    }
    if (action === 'runExportTrajectories') { run('-t yes -l 1'); return; }
    var window = ['30m', '60m', '120m'].indexOf(args.window) !== -1 ? args.window : null;
    probeExportCapabilities(function (caps, error) {
        if (error) { finish(error); return; }
        if (action === 'runExportSettings') {
            if (!caps.supportsSettingsOnly) { finish('This Launchpad does not support settings-only export'); return; }
            run("--settings-only --reason 'settings backup'");
        } else if (window) {
            if (!caps.supportsArbitraryWindow) { finish('This Launchpad does not support an explicit log window; refresh export capabilities'); return; }
            run('-l ' + window);
        } else {
            run('-l ' + (caps.supports30m ? '30m' : (caps.supports2h ? '2h' : '1')));
        }
    });
}

function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function buildExportSuArgv(pythonArgs) {
    var fs = require('fs');
    var cmd = ['. /home/user/.profile || true', 'cd ' + shellQuote(EXPORT_CWD)];
    try {
        var content = fs.readFileSync('/home/user/keys/personal_config.sh').toString();
        var serial = content.match(/^\s*(?:export\s+)?SERIAL=(.*)$/m);
        if (serial) {
            var value = serial[1].trim();
            if ((value.charAt(0) === '"' && value.slice(-1) === '"') ||
                (value.charAt(0) === "'" && value.slice(-1) === "'")) value = value.slice(1, -1);
            cmd.push('export SERIAL=' + shellQuote(value));
        }
    } catch (e) { dbg('Could not read device SERIAL: ' + e); }
    cmd.push('export PYTHONPATH="$PYTHONPATH:/home/user/launchpad/libs"');
    cmd.push('exec ' + shellQuote(PYTHON_BIN) + ' ' + shellQuote(EXPORT_SCRIPT) + ' ' + pythonArgs);
    return ['/bin/su', ['-', 'user', '-c', cmd.join(' && ')]];
}

// Bound captured output; process errors and exit may both fire, but finish once.
function runPython(pythonArgs, timeoutMs, callback) {
    var proc, timer, done = false, stdout = '', stderr = '';
    function finish(error) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        callback(stdout, error);
    }
    try {
        if (!require('fs').existsSync(EXPORT_SCRIPT)) { finish('Script not found: ' + EXPORT_SCRIPT); return; }
        var argv = buildExportSuArgv(pythonArgs);
        proc = require('child_process').execFile(argv[0], argv[1], {});
        if (!proc || !proc.stdout || !proc.stderr) { finish('Could not start Launchpad export process'); return; }
        proc.stdout.on('data', function (chunk) { stdout = (stdout + chunk.toString()).slice(-65536); });
        proc.stderr.on('data', function (chunk) { stderr = (stderr + chunk.toString()).slice(-65536); });
        proc.on('error', function (error) { finish('Process error: ' + error); });
        proc.on('exit', function (code) {
            finish(code === 0 ? null : 'Export process failed: ' + (stderr.trim() || stdout.trim() || 'exit code ' + code));
        });
        if (timeoutMs) timer = setTimeout(function () {
            if (done) return;
            finish('Launchpad capability check timed out');
            try { proc.kill(); } catch (e) { }
        }, timeoutMs);
    } catch (e) { finish('Could not run Launchpad: ' + e); }
}

function readCachedCapabilities() {
    try {
        var raw = db.Get(CAPABILITY_CACHE_KEY);
        var caps = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!caps || typeof caps.checkedAt !== 'number' || Date.now() < caps.checkedAt || Date.now() - caps.checkedAt >= CAPABILITY_TTL_MS) return null;
        var fields = ['supports30m', 'supports2h', 'supportsSettingsOnly', 'supportsArbitraryWindow'];
        for (var i = 0; i < fields.length; i++) if (typeof caps[fields[i]] !== 'boolean') return null;
        return caps;
    } catch (e) { return null; }
}

function probeExportCapabilities(callback, force) {
    // Join an active probe so simultaneous UI checks/exports share one process.
    if (probeWaiters) { probeWaiters.push(callback); return; }
    var cached = !force && readCachedCapabilities();
    if (cached) { callback(cached); return; }
    probeWaiters = [callback];
    runPython('--help', 20000, function (stdout, error) {
        var caps = null;
        if (!error) {
            caps = {
                supports30m: stdout.indexOf('30m') !== -1,
                supports2h: stdout.indexOf('2h') !== -1,
                supportsSettingsOnly: stdout.indexOf('--settings-only') !== -1,
                supportsArbitraryWindow: stdout.indexOf('--log-window') !== -1,
                checkedAt: Date.now()
            };
            try { db.Put(CAPABILITY_CACHE_KEY, caps); } catch (e) { dbg('Cannot cache capabilities: ' + e); }
        }
        var waiters = probeWaiters;
        probeWaiters = null;
        for (var i = 0; i < waiters.length; i++) waiters[i](caps, error);
    });
}

module.exports = { consoleaction: consoleaction };
