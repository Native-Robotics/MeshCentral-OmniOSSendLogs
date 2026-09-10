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

function loadAgent(store, help) {
    const processes = [];
    const commands = [];
    const responses = [];
    const context = {
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
                    return { existsSync: () => true, readFileSync: () => 'SERIAL=test' };
                case 'child_process':
                    return { execFile(file, args) {
                        commands.push({ file, args });
                        const proc = new EventEmitter();
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
        check() {
            context.module.exports.consoleaction({ pluginaction: 'checkExportCapabilities' }, 0, 'session', {
                SendCommand: msg => responses.push(JSON.parse(JSON.stringify(msg)))
            });
            while (processes.length) {
                const proc = processes.shift();
                proc.stdout.emit('data', help);
                proc.emit('exit', 0);
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
        assert.match(agent.commands[0].args[3], /export_data\.py --help$/);
        assert.deepEqual(JSON.parse(store.get(cacheKey)), {
            ...legacyCaps, supportsArbitraryWindow: arbitraryWindow
        });

        // A fresh module instance must reuse the persisted migration result.
        const reloaded = loadAgent(store, '');
        assert.equal(reloaded.check().arbitraryWindow, arbitraryWindow);
        assert.equal(reloaded.commands.length, 0);
    });

    test('reuses current cache with arbitrary window support = ' + arbitraryWindow, () => {
        const store = new Map([[cacheKey, JSON.stringify({ ...legacyCaps, supportsArbitraryWindow: arbitraryWindow })]]);
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
