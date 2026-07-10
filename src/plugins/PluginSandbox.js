import 'ses';

function createScopedConsole(pluginId) {
  return new Proxy(console, {
    get(target, prop) {
      if (typeof target[prop] !== 'function') return target[prop];
      return (...args) => {
        const [first, ...rest] = args;
        const prefix = `[plugin:${pluginId}]`;
        if (typeof first === 'string') {
          target[prop](`${prefix} ${first}`, ...rest);
        } else {
          target[prop](prefix, ...args);
        }
      };
    },
  });
}

function toCJS(esm) {
  let code = esm
    .replace(/^import\s.*?;?\s*$/gm, '')
    .replace(/^import\s+type\s.*?;?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'module.exports = ')
    .replace(/^export\s+function\s+(\w+)/gm, 'module.exports.$1 = function $1')
    .replace(/^export\s+(const|let|var)\s+(\w+)/gm, '$1 $2; module.exports.$2 = $2')
    .replace(/^export\s*\{[^}]+\}\s*;?\s*$/gm, '');

  return `(function(module) { ${code} return module.exports; }({ exports: {} }))`;
}

export class PluginSandbox {
  constructor(pluginId, sourceCode, beaverNotes) {
    const globals = {
      beaverNotes,
      console: createScopedConsole(pluginId),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      queueMicrotask,
      URL,
      TextEncoder,
      TextDecoder,
    };

    this._compartment = new Compartment({ globals, __options__: true });
    this._source = sourceCode;
    this._exports = null;
  }

  evaluate() {
    const cjs = toCJS(this._source);
    try {
      this._exports = this._compartment.evaluate(cjs);
    } catch (e) {
      console.error(`[PluginSandbox] Failed to evaluate plugin:`, e);
      throw e;
    }
    return this._exports;
  }

  get exports() {
    return this._exports;
  }
}
