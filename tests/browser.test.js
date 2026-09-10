'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const plugin = require('../omniossendlogs.js').omniossendlogs({parent: {webserver: {}, debug() {}}});
function browser() {
    const messages = [], timers = [], cell = {innerHTML: ''}, inserted = [];
    let existing = true;
    const tbody = {children: [], insertAdjacentHTML: (where, html) => inserted.push(html)};
    const table = {querySelector: selector => selector === '#omniossendlogsTableRow' ?
        (existing ? {querySelector: () => cell} : null) : tbody, getElementsByTagName: () => []};
    const context = {pluginHandler: {omniossendlogs: {}}, document: {}, currentNode: {_id: 'node/test/one'},
        Q: () => ({querySelector: () => table}), console: {log() {}},
        meshserver: {send: msg => messages.push(JSON.parse(JSON.stringify(msg)))},
        setTimeout(fn, ms) {timers.push({fn, ms}); return timers.length;}};
    vm.createContext(context);
    for (const name of plugin.exports) context.pluginHandler.omniossendlogs[name] = vm.runInContext('(' + plugin[name].toString() + ')', context);
    return {h: context.pluginHandler.omniossendlogs, context, messages, timers, cell, inserted,
        setExisting(value) {existing = value;}};
}
function caps(b, request, payload) {
    b.h.exportCapabilitiesResult(null, {data: {nodeid: request.nodeid, clientRequestId: request.clientRequestId, ...payload}});
}
test('capability errors and lost responses can be retried without reloading the page', () => {
    const b = browser();
    b.h.onDeviceRefreshEnd();
    const first = b.messages[0];
    caps(b, first, {error: 'temporary failure'});
    assert.equal(b.h.settingsCapability[first.nodeid], undefined);
    b.h.requestExportCapabilities(true);
    assert.equal(b.messages.length, 2);
    const second = b.messages[1];
    assert.equal(second.force, true);
    caps(b, first, {settingsOnly: false, arbitraryWindow: false});
    assert.equal(b.h.settingsCapability[first.nodeid], undefined);
    b.timers.filter(t => t.ms === 35000).at(-1).fn();
    assert(b.cell.innerHTML.includes('timed out'));
    b.h.onDeviceRefreshEnd();
    assert.equal(b.messages.length, 3);
    caps(b, b.messages.at(-1), {settingsOnly: true, arbitraryWindow: true});
    assert.equal(b.h.windowCapability[first.nodeid], true);
});
test('renders legacy and modern links, including the initial row insertion path', () => {
    const b = browser();
    for (const arbitraryWindow of [false, true]) {
        b.h.requestExportCapabilities(true);
        caps(b, b.messages.at(-1), {settingsOnly: true, arbitraryWindow});
        assert.equal(b.cell.innerHTML.includes('(last 60 min)'), arbitraryWindow);
        b.setExisting(false); b.h.injectGeneral(); b.setExisting(true);
        assert.equal(b.inserted.at(-1).includes('(last 120 min)'), arbitraryWindow);
    }
    b.h.startExport('triggerExport', '120m');
    assert.equal(b.messages.at(-1).window, '120m');
    assert.equal((b.cell.innerHTML.match(/pointer-events:none/g) || []).length, 5);
});
test('old timers and late results cannot change a subsequent export', () => {
    const b = browser(), id = b.context.currentNode._id;
    b.h.triggerExport('30m');
    const first = b.messages.at(-1);
    const finish = request => b.h.exportResult(null, {data: {nodeid: id, clientRequestId: request.clientRequestId, status: 'success', message: 'ok'}});
    finish(first);
    const oldTimers = b.timers.slice();
    b.h.triggerExport('120m');
    const second = b.messages.at(-1);
    oldTimers.forEach(t => t.fn());
    finish(first);
    b.h.exportResult(null, {data: {nodeid: id, status: 'success'}});
    assert.equal(b.h.exportStatus[id].status, 'running');
    finish(second);
    assert.equal(b.h.exportStatus[id].status, 'success');
});
test('expired browser capabilities are requested again and missing currentNode is safe', () => {
    const b = browser();
    b.h.onDeviceRefreshEnd();
    const request = b.messages[0];
    caps(b, request, {settingsOnly: false, arbitraryWindow: false});
    b.h.onDeviceRefreshEnd();
    assert.equal(b.messages.length, 1);
    b.h.capabilityChecked[request.nodeid] = Date.now() - 300001;
    b.h.onDeviceRefreshEnd();
    assert.equal(b.messages.length, 2);
    delete b.context.currentNode;
    b.h.onDeviceRefreshEnd();
    b.h.triggerExport();
    assert.equal(b.messages.length, 2);
});
