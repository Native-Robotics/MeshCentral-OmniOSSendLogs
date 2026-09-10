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
        assert.deepEqual(saved, { ...legacyCaps, supportsArbitraryWindow: arbitraryWindow, checkedAt: saved.checkedAt });

        // A fresh module instance must reuse the persisted migration result.
        const reloaded = loadAgent(store, '');
        assert.equal(reloaded.check().arbitraryWindow, arbitraryWindow);
        assert.equal(reloaded.commands.length, 0);
    });

    test('reuses current cache with arbitrary window support = ' + arbitraryWindow, () => {
        const store = new Map([[cacheKey, JSON.stringify({ ...legacyCaps, supportsArbitraryWindow: arbitraryWindow, checkedAt: Date.now() })]]);
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
