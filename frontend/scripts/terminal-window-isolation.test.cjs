const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('tool windows own separate terminal sessions and restore them without overwriting standalone terminals', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/terminal/workspace-store.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const storage = new Map();
  const load = (name = '') => {
    const window = {
      name,
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    };
    window.parent = name ? {} : window;
    const exports = {};
    vm.runInNewContext(compiled, {
      exports, window,
      require: name => { assert.equal(name, 'react'); return {}; },
    });
    return exports;
  };
  const standalone = load();
  const originalPane = standalone.workspace.openPane(1);
  const original = storage.get('lcc.terminal-workspace.v1');
  const left = load('lcc-window:left');
  const leftPane = left.workspace.openPane(2);
  const right = load('lcc-window:right');
  const rightPane = right.workspace.openPane(3);

  assert.equal(storage.get('lcc.terminal-workspace.v1'), original);
  assert.equal(Object.keys(left.getWorkspace().panes).length, 1);
  assert.equal(Object.keys(right.getWorkspace().panes).length, 1);
  assert.equal(load('lcc-window:left').getWorkspace().panes[leftPane].serverId, 2);
  assert.equal(load('lcc-window:right').getWorkspace().panes[rightPane].serverId, 3);
  assert.equal(load().getWorkspace().panes[originalPane].serverId, 1);
  assert.equal(storage.size, 3);
});
