'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../modules_meshcore/omniossendlogs.js'), 'utf8');
const cacheKey = 'plugin_omniossendlogs_capabilities_cache';
const legacyCaps = { supports30m: true, supports2h: true, supportsSettingsOnly: true };

function loadAgent(store, help, options = {}) {
    const processes = [];
    const commands = [];
    const responses = [];
    const timers = [];
    const context = {
        setTimeout(fn) { timers.push(fn); return timers.length; },
        clearTimeout() {},
        module: { exports: {} },
        require(name) {
            switch (name) {
                case 'SimpleDataStore':
                    return { Shared: () => ({
                        Get: key => store.get(key),
                        Put: (key, value) => store.set(key, JSON.stringify(value))
                    }) };
                case 'MeshAgent':
                    return { SendCommand() {} };
                case 'fs':
                    return { existsSync: () => options.exists !== false, readFileSync: () => options.config || 'SERIAL=test' };
                case 'child_process':
                    return { execFile(file, args) {
                        commands.push({ file, args });
                        const proc = new EventEmitter();
                        proc.kill = () => {};
                        proc.stdout = new EventEmitter();
                        proc.stderr = new EventEmitter();
                        processes.push(proc);
                        return proc;
                    } };
                default:
                    throw new Error('Unexpected module: ' + name);
            }
        }
    };
    vm.runInNewContext(source, context);
    return {
        commands,
        responses,
        act(action, args = {}, rights = 16) {
            context.module.exports.consoleaction({ pluginaction: action, ...args }, rights, undefined, {
                SendCommand: msg => responses.push(JSON.parse(JSON.stringify(msg)))
            });
        },
        drain(code = 0) {
            while (processes.length) {
                const proc = processes.shift();
                proc.stdout.emit('data', help);
                proc.emit('exit', code);
            }
        },
        timers,
        check(force) {
            context.module.exports.consoleaction({ pluginaction: 'checkExportCapabilities', force }, 0, undefined, {
                SendCommand: msg => responses.push(JSON.parse(JSON.stringify(msg)))
            });
            while (processes.length) {
                const proc = processes.shift();
                proc.stdout.emit('data', help);
                proc.emit('exit', options.exitCode || 0);
            }
            return responses.pop();
        }
    };
}

for (const arbitraryWindow of [true, false]) {
    test('migrates legacy cache with arbitrary window support = ' + arbitraryWindow, () => {
        const store = new Map([[cacheKey, JSON.stringify(legacyCaps)]]);
        const help = '--settings-only 30m 2h' + (arbitraryWindow ? ' --log-window' : '');
        const agent = loadAgent(store, help);
        assert.deepEqual(agent.check(), {
            action: 'plugin', plugin: 'omniossendlogs', pluginaction: 'exportCapabilitiesResult',
            settingsOnly: true, arbitraryWindow
        });
        assert.equal(agent.commands.length, 1);
        assert.match(agent.commands[0].args[3], /export_data\.py\' --help$/);
        const saved = JSON.parse(store.get(cacheKey));
        assert.equal(typeof saved.checkedAt, 'number');
        assert.deepEqual(saved, { ...legacyCaps, supportsArbitraryWindow: arbitraryWindow, supportsZeroSessionWindow: false, checkedAt: saved.checkedAt });

        // A fresh module instance must reuse the persisted migration result.
        const reloaded = loadAgent(store, '');
        assert.equal(reloaded.check().arbitraryWindow, arbitraryWindow);
        assert.equal(reloaded.commands.length, 0);
    });

    test('reuses current cache with arbitrary window support = ' + arbitraryWindow, () => {
        const store = new Map([[cacheKey, JSON.stringify({ ...legacyCaps, supportsArbitraryWindow: arbitraryWindow, supportsZeroSessionWindow: false, checkedAt: Date.now() })]]);
        const agent = loadAgent(store, '');
        assert.equal(agent.check().arbitraryWindow, arbitraryWindow);
        assert.equal(agent.commands.length, 0);
    });
}

test('reprobes when the cached arbitrary window flag has an invalid type', () => {
    for (const invalid of [null, 'false', 'true', 0, 1, [], {}]) {
        const store = new Map([[cacheKey, JSON.stringify({ ...legacyCaps, supportsArbitraryWindow: invalid })]]);
        const agent = loadAgent(store, '--settings-only --log-window 30m 2h');
        assert.equal(agent.check().arbitraryWindow, true);
        assert.equal(agent.commands.length, 1);
    }
});


test('expired capabilities and forced refresh probe installed Launchpad again', () => {
    for (const force of [false, true]) {
        const store = new Map([[cacheKey, JSON.stringify({ ...legacyCaps, supportsArbitraryWindow: false,
            checkedAt: force ? Date.now() : Date.now() - 300001 })]]);
        const agent = loadAgent(store, '--log-window --settings-only');
        assert.equal(agent.check(force).arbitraryWindow, true);
        assert.equal(agent.commands.length, 1);
    }
});

test('missing script and failed help do not persist unsupported capabilities', () => {
    for (const options of [{exists: false}, {exitCode: 1}]) {
        const store = new Map();
        const agent = loadAgent(store, '--log-window', options);
        assert(agent.check().error);
        assert.equal(store.size, 0);
    }
});

test('direct export rejects view-only or missing rights before executing anything', () => {
    const agent = loadAgent(new Map(), '');
    for (const rights of [0, 8, 256, null]) agent.act('runExport', {window: '60m'}, rights);
    assert.equal(agent.commands.length, 0);
    assert.equal(agent.responses.length, 4);
    assert(agent.responses.every(r => r.success === false));
});

test('serializes exports on agent and preserves request IDs during a shared probe', () => {
    const agent = loadAgent(new Map(), '--log-window --settings-only 30m 2h');
    agent.act('runExport', {window: '60m', requestId: 'first'});
    agent.act('runExport', {window: '120m', requestId: 'second'});
    agent.act('checkExportCapabilities', {requestId: 'probe'});
    assert.equal(agent.commands.length, 1);
    assert.equal(agent.responses[0].requestId, 'second');
    assert.equal(agent.responses[0].success, false);
    agent.drain();
    assert.equal(agent.commands.length, 2);
    assert(agent.commands[1].args[3].endsWith('--mode server -l 60m'));
    assert(agent.responses.some(r => r.requestId === 'first' && r.success === true));
    assert(agent.responses.some(r => r.requestId === 'probe' && r.arbitraryWindow === true));
});

test('probe timeout replies once and can be retried without poisoned cache', () => {
    const store = new Map(), agent = loadAgent(store, '--log-window');
    agent.act('checkExportCapabilities');
    agent.timers[0]();
    assert.equal(agent.responses.length, 1);
    assert(agent.responses[0].error.includes('timed out'));
    agent.drain();
    assert.equal(agent.responses.length, 1);
    assert.equal(store.size, 0);
    assert.equal(agent.check().arbitraryWindow, true);
});

test('shell command quotes SERIAL data and keeps the selected window literal', () => {
    const agent = loadAgent(new Map(), '--log-window', {config: "SERIAL=O'Brien;touch /tmp/pwned"});
    agent.act('runExport', {window: '120m'});
    agent.drain();
    assert(agent.commands[0].args[3].includes("export SERIAL='O'\\''Brien;touch /tmp/pwned'"));
    assert(agent.commands[1].args[3].endsWith('--mode server -l 120m'));
});

test('runExportTrajectories omits sessions once the agent confirms -l 0 support', () => {
    const store = new Map();
    const agent = loadAgent(store, '--log-window --settings-only 30m 2h a session count (0, 1, 5, 42), all, an ISO 8601 duration');
    agent.act('runExportTrajectories', {requestId: 'traj'});
    agent.drain();
    assert.equal(agent.commands.length, 2);
    assert.match(agent.commands[0].args[3], /export_data\.py\' --help$/);
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 0'));
    assert.equal(JSON.parse(store.get(cacheKey)).supportsZeroSessionWindow, true);
    assert(agent.responses.some(r => r.requestId === 'traj' && r.success === true));
});

test('runExportTrajectories keeps -l 1 on an old Launchpad with no --log-window at all', () => {
    const store = new Map();
    const agent = loadAgent(store, '--settings-only 30m 2h');
    agent.act('runExportTrajectories');
    agent.drain();
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 1'));
    assert.equal(JSON.parse(store.get(cacheKey)).supportsZeroSessionWindow, false);
});

test('runExportTrajectories keeps -l 1 when --log-window exists but its example list has no 0', () => {
    const store = new Map();
    const agent = loadAgent(store, '--log-window --settings-only 30m 2h a session count (1, 5, 42), all, an ISO 8601 duration');
    agent.act('runExportTrajectories');
    agent.drain();
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 1'));
    assert.equal(JSON.parse(store.get(cacheKey)).supportsZeroSessionWindow, false);
});

test('runExportTrajectories detects -l 0 support even when argparse wraps the example list', () => {
    const store = new Map();
    const wrapped = '--log-window --settings-only 30m 2h a session count (0, 1,\n' +
        '                        5, 42), all, an ISO 8601 duration';
    const agent = loadAgent(store, wrapped);
    agent.act('runExportTrajectories');
    agent.drain();
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 0'));
    assert.equal(JSON.parse(store.get(cacheKey)).supportsZeroSessionWindow, true);
});

test('a decoy 0 elsewhere in --help does not cause a false positive', () => {
    const store = new Map();
    const decoy = '--log-window --settings-only 30m 120m a session count (1, 5, 42), all, ' +
        'an ISO 8601 interval (2026-07-16T09:00:00Z/PT2H) or the legacy 30m/2h/1d shorthand (default: 5)';
    const agent = loadAgent(store, decoy);
    agent.act('runExportTrajectories');
    agent.drain();
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 1'));
    assert.equal(JSON.parse(store.get(cacheKey)).supportsZeroSessionWindow, false);
});

test('a stale cache without supportsZeroSessionWindow triggers exactly one fresh probe', () => {
    const store = new Map([[cacheKey, JSON.stringify({...legacyCaps, supportsArbitraryWindow: true, checkedAt: Date.now()})]]);
    const agent = loadAgent(store, '--log-window --settings-only 30m 2h (0, 1, 5, 42)');
    agent.act('runExportTrajectories');
    agent.drain();
    assert.equal(agent.commands.length, 2); // one --help probe, then the export - not zero, not more
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 0'));
    assert.equal(JSON.parse(store.get(cacheKey)).supportsZeroSessionWindow, true);
});

for (const zeroSessionWindow of [true, false]) {
    test('a valid fresh cache with supportsZeroSessionWindow = ' + zeroSessionWindow + ' is used without a new probe', () => {
        const store = new Map([[cacheKey, JSON.stringify({...legacyCaps, supportsArbitraryWindow: true, supportsZeroSessionWindow: zeroSessionWindow, checkedAt: Date.now()})]]);
        const agent = loadAgent(store, ''); // no --help call expected, so the fixture content is irrelevant
        agent.act('runExportTrajectories');
        agent.drain();
        assert.equal(agent.commands.length, 1); // only the export call, no --help call
        assert(agent.commands[0].args[3].endsWith('--mode server -t yes -l ' + (zeroSessionWindow ? '0' : '1')));
    });
}

test('reprobes when the cached zero-session window flag has an invalid type', () => {
    for (const invalid of [null, 'false', 'true', 0, 1, [], {}]) {
        const store = new Map([[cacheKey, JSON.stringify({...legacyCaps, supportsArbitraryWindow: true, supportsZeroSessionWindow: invalid})]]);
        const agent = loadAgent(store, '--settings-only --log-window 30m 2h (0, 1, 5, 42)');
        assert.equal(agent.check().arbitraryWindow, true);
        assert.equal(agent.commands.length, 1);
        assert.equal(JSON.parse(store.get(cacheKey)).supportsZeroSessionWindow, true);
    }
});

test('expired zero-session capability and forced refresh probe installed Launchpad again', () => {
    for (const force of [false, true]) {
        const store = new Map([[cacheKey, JSON.stringify({...legacyCaps, supportsArbitraryWindow: true, supportsZeroSessionWindow: false,
            checkedAt: force ? Date.now() : Date.now() - 300001})]]);
        const agent = loadAgent(store, '--log-window --settings-only (0, 1, 5, 42)');
        assert.equal(agent.check(force).arbitraryWindow, true);
        assert.equal(agent.commands.length, 1);
        assert.equal(JSON.parse(store.get(cacheKey)).supportsZeroSessionWindow, true);
    }
});

test('a probe exit failure while exporting trajectories falls back to -l 1 without caching a negative result', () => {
    const store = new Map();
    const agent = loadAgent(store, '');
    agent.act('runExportTrajectories', {requestId: 'traj-err'});
    agent.drain(1); // --help exits non-zero; cascades synchronously into the actual export call
    assert.equal(agent.commands.length, 2);
    assert.match(agent.commands[0].args[3], /export_data\.py\' --help$/);
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 1'));
    assert.equal(store.size, 0);
});

test('a probe timeout while exporting trajectories falls back to -l 1 without caching a negative result', () => {
    const store = new Map();
    const agent = loadAgent(store, '');
    agent.act('runExportTrajectories', {requestId: 'traj-timeout'});
    agent.timers[0](); // fire the --help probe's 20s timeout synchronously
    assert.equal(agent.responses.length, 0); // no exportResult yet: the fallback proceeds straight to run()
    assert.equal(agent.commands.length, 2); // --help call plus the now-queued -t yes -l 1 export call
    agent.drain(); // let the actual export process complete
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 1'));
    assert.equal(store.size, 0);
    assert.equal(agent.responses.length, 1);
    assert.equal(agent.responses[0].success, true);
});

test('runExportTrajectories shares one probe with a concurrent capability check', () => {
    const agent = loadAgent(new Map(), '--log-window --settings-only 30m 2h (0, 1, 5, 42)');
    agent.act('runExportTrajectories', {requestId: 'traj'});
    agent.act('checkExportCapabilities', {requestId: 'probe'});
    assert.equal(agent.commands.length, 1); // only the shared --help call so far
    agent.drain();
    assert.equal(agent.commands.length, 2); // --help, then the trajectories export
    assert(agent.commands[1].args[3].endsWith('--mode server -t yes -l 0'));
    assert(agent.responses.some(r => r.requestId === 'probe' && r.arbitraryWindow === true));
    assert(agent.responses.some(r => r.requestId === 'traj' && r.success === true));
});

test('a second runExportTrajectories call is rejected as busy while the first is still probing', () => {
    const agent = loadAgent(new Map(), '--log-window --settings-only 30m 2h (0, 1, 5, 42)');
    agent.act('runExportTrajectories', {requestId: 'first'});
    agent.act('runExportTrajectories', {requestId: 'second'});
    assert.equal(agent.responses.length, 1);
    assert.equal(agent.responses[0].requestId, 'second');
    assert.equal(agent.responses[0].success, false);
    assert.match(agent.responses[0].message, /still running/);
    agent.drain();
    assert.equal(agent.responses.length, 2);
    assert.equal(agent.responses[1].requestId, 'first');
    assert.equal(agent.responses[1].success, true);
});
