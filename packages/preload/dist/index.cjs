"use strict";
var require$$0 = require("electron");
var fs = require("fs");
var promises = require("fs/promises");
var path = require("path");
function _interopDefaultLegacy(e) {
  return e && typeof e === "object" && "default" in e ? e : { "default": e };
}
var require$$0__default = /* @__PURE__ */ _interopDefaultLegacy(require$$0);
var path__default = /* @__PURE__ */ _interopDefaultLegacy(path);
class NonError extends Error {
  constructor(message) {
    super(NonError._prepareSuperMessage(message));
    Object.defineProperty(this, "name", {
      value: "NonError",
      configurable: true,
      writable: true
    });
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NonError);
    }
  }
  static _prepareSuperMessage(message) {
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}
const commonProperties = [
  { property: "name", enumerable: false },
  { property: "message", enumerable: false },
  { property: "stack", enumerable: false },
  { property: "code", enumerable: true }
];
const isCalled = Symbol(".toJSON called");
const toJSON = (from) => {
  from[isCalled] = true;
  const json = from.toJSON();
  delete from[isCalled];
  return json;
};
const destroyCircular = ({
  from,
  seen,
  to_,
  forceEnumerable,
  maxDepth,
  depth
}) => {
  const to = to_ || (Array.isArray(from) ? [] : {});
  seen.push(from);
  if (depth >= maxDepth) {
    return to;
  }
  if (typeof from.toJSON === "function" && from[isCalled] !== true) {
    return toJSON(from);
  }
  for (const [key, value] of Object.entries(from)) {
    if (typeof Buffer === "function" && Buffer.isBuffer(value)) {
      to[key] = "[object Buffer]";
      continue;
    }
    if (typeof value === "function") {
      continue;
    }
    if (!value || typeof value !== "object") {
      to[key] = value;
      continue;
    }
    if (!seen.includes(from[key])) {
      depth++;
      to[key] = destroyCircular({
        from: from[key],
        seen: seen.slice(),
        forceEnumerable,
        maxDepth,
        depth
      });
      continue;
    }
    to[key] = "[Circular]";
  }
  for (const { property, enumerable } of commonProperties) {
    if (typeof from[property] === "string") {
      Object.defineProperty(to, property, {
        value: from[property],
        enumerable: forceEnumerable ? true : enumerable,
        configurable: true,
        writable: true
      });
    }
  }
  return to;
};
const serializeError$2 = (value, options = {}) => {
  const { maxDepth = Number.POSITIVE_INFINITY } = options;
  if (typeof value === "object" && value !== null) {
    return destroyCircular({
      from: value,
      seen: [],
      forceEnumerable: true,
      maxDepth,
      depth: 0
    });
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "anonymous"}]`;
  }
  return value;
};
const deserializeError$2 = (value, options = {}) => {
  const { maxDepth = Number.POSITIVE_INFINITY } = options;
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const newError = new Error();
    destroyCircular({
      from: value,
      seen: [],
      to_: newError,
      maxDepth,
      depth: 0
    });
    return newError;
  }
  return new NonError(value);
};
var serializeError_1 = {
  serializeError: serializeError$2,
  deserializeError: deserializeError$2
};
var util$2 = {};
const getUniqueId = () => `${Date.now()}-${Math.random()}`;
const getSendChannel = (channel) => `%better-ipc-send-channel-${channel}`;
const getRendererSendChannel = (channel) => `%better-ipc-send-channel-${channel}`;
util$2.currentWindowChannel = "%better-ipc-current-window";
util$2.getSendChannel = getSendChannel;
util$2.getRendererSendChannel = getRendererSendChannel;
util$2.getResponseChannels = (channel) => {
  const id = getUniqueId();
  return {
    sendChannel: getSendChannel(channel),
    dataChannel: `%better-ipc-response-data-channel-${channel}-${id}`,
    errorChannel: `%better-ipc-response-error-channel-${channel}-${id}`
  };
};
util$2.getRendererResponseChannels = (channel) => {
  const id = getUniqueId();
  return {
    sendChannel: getRendererSendChannel(channel),
    dataChannel: `%better-ipc-response-data-channel-${channel}-${id}`,
    errorChannel: `%better-ipc-response-error-channel-${channel}-${id}`
  };
};
const electron$1 = require$$0__default["default"];
const { serializeError: serializeError$1, deserializeError: deserializeError$1 } = serializeError_1;
const util$1 = util$2;
const { ipcRenderer: ipcRenderer$1 } = electron$1;
const ipc$1 = Object.create(ipcRenderer$1 || {});
ipc$1.callMain = (channel, data) => new Promise((resolve, reject) => {
  const { sendChannel, dataChannel, errorChannel } = util$1.getResponseChannels(channel);
  const cleanup = () => {
    ipcRenderer$1.off(dataChannel, onData);
    ipcRenderer$1.off(errorChannel, onError);
  };
  const onData = (_event, result) => {
    cleanup();
    resolve(result);
  };
  const onError = (_event, error) => {
    cleanup();
    reject(deserializeError$1(error));
  };
  ipcRenderer$1.once(dataChannel, onData);
  ipcRenderer$1.once(errorChannel, onError);
  const completeData = {
    dataChannel,
    errorChannel,
    userData: data
  };
  ipcRenderer$1.send(sendChannel, completeData);
});
ipc$1.answerMain = (channel, callback) => {
  const sendChannel = util$1.getRendererSendChannel(channel);
  const listener = async (_event, data) => {
    const { dataChannel, errorChannel, userData } = data;
    try {
      ipcRenderer$1.send(dataChannel, await callback(userData));
    } catch (error) {
      ipcRenderer$1.send(errorChannel, serializeError$1(error));
    }
  };
  ipcRenderer$1.on(sendChannel, listener);
  return () => {
    ipcRenderer$1.off(sendChannel, listener);
  };
};
var renderer = ipc$1;
const electron = require$$0__default["default"];
const { serializeError, deserializeError } = serializeError_1;
const util = util$2;
const { ipcMain, BrowserWindow } = electron;
const ipc = Object.create(ipcMain || {});
ipc.callRenderer = (browserWindow, channel, data) => new Promise((resolve, reject) => {
  if (!browserWindow) {
    throw new Error("Browser window required");
  }
  const { sendChannel, dataChannel, errorChannel } = util.getRendererResponseChannels(channel);
  const cleanup = () => {
    ipcMain.off(dataChannel, onData);
    ipcMain.off(errorChannel, onError);
  };
  const onData = (event, result) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window.id === browserWindow.id) {
      cleanup();
      resolve(result);
    }
  };
  const onError = (event, error) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window.id === browserWindow.id) {
      cleanup();
      reject(deserializeError(error));
    }
  };
  ipcMain.on(dataChannel, onData);
  ipcMain.on(errorChannel, onError);
  const completeData = {
    dataChannel,
    errorChannel,
    userData: data
  };
  if (browserWindow.webContents) {
    browserWindow.webContents.send(sendChannel, completeData);
  }
});
ipc.callFocusedRenderer = async (...args) => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) {
    throw new Error("No browser window in focus");
  }
  return ipc.callRenderer(focusedWindow, ...args);
};
ipc.answerRenderer = (browserWindowOrChannel, channelOrCallback, callbackOrNothing) => {
  let window;
  let channel;
  let callback;
  if (callbackOrNothing === void 0) {
    channel = browserWindowOrChannel;
    callback = channelOrCallback;
  } else {
    window = browserWindowOrChannel;
    channel = channelOrCallback;
    callback = callbackOrNothing;
    if (!window) {
      throw new Error("Browser window required");
    }
  }
  const sendChannel = util.getSendChannel(channel);
  const listener = async (event, data) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (window && window.id !== browserWindow.id) {
      return;
    }
    const send = (channel2, data2) => {
      if (!(browserWindow && browserWindow.isDestroyed())) {
        event.sender.send(channel2, data2);
      }
    };
    const { dataChannel, errorChannel, userData } = data;
    try {
      send(dataChannel, await callback(userData, browserWindow));
    } catch (error) {
      send(errorChannel, serializeError(error));
    }
  };
  ipcMain.on(sendChannel, listener);
  return () => {
    ipcMain.off(sendChannel, listener);
  };
};
ipc.sendToRenderers = (channel, data) => {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.webContents) {
      browserWindow.webContents.send(channel, data);
    }
  }
};
var ipcRenderer;
if (process.type === "renderer") {
  ipcRenderer = renderer;
}
const apiKey = "electron";
const api = {
  path: path__default["default"],
  clipboard: require$$0.clipboard,
  ipcRenderer,
  access: (dir) => promises.access(dir, fs.constants.R_OK | fs.constants.W_OK),
  versions: process.versions
};
{
  require$$0.contextBridge.exposeInMainWorld(apiKey, api);
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguY2pzIiwic291cmNlcyI6WyIuLi8uLi8uLi9ub2RlX21vZHVsZXMvc2VyaWFsaXplLWVycm9yL2luZGV4LmpzIiwiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL2VsZWN0cm9uLWJldHRlci1pcGMvc291cmNlL3V0aWwuanMiLCIuLi8uLi8uLi9ub2RlX21vZHVsZXMvZWxlY3Ryb24tYmV0dGVyLWlwYy9zb3VyY2UvcmVuZGVyZXIuanMiLCIuLi8uLi8uLi9ub2RlX21vZHVsZXMvZWxlY3Ryb24tYmV0dGVyLWlwYy9zb3VyY2UvbWFpbi5qcyIsIi4uLy4uLy4uL25vZGVfbW9kdWxlcy9lbGVjdHJvbi1iZXR0ZXItaXBjL2luZGV4LmpzIiwiLi4vc3JjL2luZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIid1c2Ugc3RyaWN0JztcblxuY2xhc3MgTm9uRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG5cdGNvbnN0cnVjdG9yKG1lc3NhZ2UpIHtcblx0XHRzdXBlcihOb25FcnJvci5fcHJlcGFyZVN1cGVyTWVzc2FnZShtZXNzYWdlKSk7XG5cdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICduYW1lJywge1xuXHRcdFx0dmFsdWU6ICdOb25FcnJvcicsXG5cdFx0XHRjb25maWd1cmFibGU6IHRydWUsXG5cdFx0XHR3cml0YWJsZTogdHJ1ZVxuXHRcdH0pO1xuXG5cdFx0aWYgKEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKSB7XG5cdFx0XHRFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCBOb25FcnJvcik7XG5cdFx0fVxuXHR9XG5cblx0c3RhdGljIF9wcmVwYXJlU3VwZXJNZXNzYWdlKG1lc3NhZ2UpIHtcblx0XHR0cnkge1xuXHRcdFx0cmV0dXJuIEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpO1xuXHRcdH0gY2F0Y2gge1xuXHRcdFx0cmV0dXJuIFN0cmluZyhtZXNzYWdlKTtcblx0XHR9XG5cdH1cbn1cblxuY29uc3QgY29tbW9uUHJvcGVydGllcyA9IFtcblx0e3Byb3BlcnR5OiAnbmFtZScsIGVudW1lcmFibGU6IGZhbHNlfSxcblx0e3Byb3BlcnR5OiAnbWVzc2FnZScsIGVudW1lcmFibGU6IGZhbHNlfSxcblx0e3Byb3BlcnR5OiAnc3RhY2snLCBlbnVtZXJhYmxlOiBmYWxzZX0sXG5cdHtwcm9wZXJ0eTogJ2NvZGUnLCBlbnVtZXJhYmxlOiB0cnVlfVxuXTtcblxuY29uc3QgaXNDYWxsZWQgPSBTeW1ib2woJy50b0pTT04gY2FsbGVkJyk7XG5cbmNvbnN0IHRvSlNPTiA9IGZyb20gPT4ge1xuXHRmcm9tW2lzQ2FsbGVkXSA9IHRydWU7XG5cdGNvbnN0IGpzb24gPSBmcm9tLnRvSlNPTigpO1xuXHRkZWxldGUgZnJvbVtpc0NhbGxlZF07XG5cdHJldHVybiBqc29uO1xufTtcblxuY29uc3QgZGVzdHJveUNpcmN1bGFyID0gKHtcblx0ZnJvbSxcblx0c2Vlbixcblx0dG9fLFxuXHRmb3JjZUVudW1lcmFibGUsXG5cdG1heERlcHRoLFxuXHRkZXB0aFxufSkgPT4ge1xuXHRjb25zdCB0byA9IHRvXyB8fCAoQXJyYXkuaXNBcnJheShmcm9tKSA/IFtdIDoge30pO1xuXG5cdHNlZW4ucHVzaChmcm9tKTtcblxuXHRpZiAoZGVwdGggPj0gbWF4RGVwdGgpIHtcblx0XHRyZXR1cm4gdG87XG5cdH1cblxuXHRpZiAodHlwZW9mIGZyb20udG9KU09OID09PSAnZnVuY3Rpb24nICYmIGZyb21baXNDYWxsZWRdICE9PSB0cnVlKSB7XG5cdFx0cmV0dXJuIHRvSlNPTihmcm9tKTtcblx0fVxuXG5cdGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb20pKSB7XG5cdFx0aWYgKHR5cGVvZiBCdWZmZXIgPT09ICdmdW5jdGlvbicgJiYgQnVmZmVyLmlzQnVmZmVyKHZhbHVlKSkge1xuXHRcdFx0dG9ba2V5XSA9ICdbb2JqZWN0IEJ1ZmZlcl0nO1xuXHRcdFx0Y29udGludWU7XG5cdFx0fVxuXG5cdFx0aWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0Y29udGludWU7XG5cdFx0fVxuXG5cdFx0aWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSB7XG5cdFx0XHR0b1trZXldID0gdmFsdWU7XG5cdFx0XHRjb250aW51ZTtcblx0XHR9XG5cblx0XHRpZiAoIXNlZW4uaW5jbHVkZXMoZnJvbVtrZXldKSkge1xuXHRcdFx0ZGVwdGgrKztcblxuXHRcdFx0dG9ba2V5XSA9IGRlc3Ryb3lDaXJjdWxhcih7XG5cdFx0XHRcdGZyb206IGZyb21ba2V5XSxcblx0XHRcdFx0c2Vlbjogc2Vlbi5zbGljZSgpLFxuXHRcdFx0XHRmb3JjZUVudW1lcmFibGUsXG5cdFx0XHRcdG1heERlcHRoLFxuXHRcdFx0XHRkZXB0aFxuXHRcdFx0fSk7XG5cdFx0XHRjb250aW51ZTtcblx0XHR9XG5cblx0XHR0b1trZXldID0gJ1tDaXJjdWxhcl0nO1xuXHR9XG5cblx0Zm9yIChjb25zdCB7cHJvcGVydHksIGVudW1lcmFibGV9IG9mIGNvbW1vblByb3BlcnRpZXMpIHtcblx0XHRpZiAodHlwZW9mIGZyb21bcHJvcGVydHldID09PSAnc3RyaW5nJykge1xuXHRcdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KHRvLCBwcm9wZXJ0eSwge1xuXHRcdFx0XHR2YWx1ZTogZnJvbVtwcm9wZXJ0eV0sXG5cdFx0XHRcdGVudW1lcmFibGU6IGZvcmNlRW51bWVyYWJsZSA/IHRydWUgOiBlbnVtZXJhYmxlLFxuXHRcdFx0XHRjb25maWd1cmFibGU6IHRydWUsXG5cdFx0XHRcdHdyaXRhYmxlOiB0cnVlXG5cdFx0XHR9KTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gdG87XG59O1xuXG5jb25zdCBzZXJpYWxpemVFcnJvciA9ICh2YWx1ZSwgb3B0aW9ucyA9IHt9KSA9PiB7XG5cdGNvbnN0IHttYXhEZXB0aCA9IE51bWJlci5QT1NJVElWRV9JTkZJTklUWX0gPSBvcHRpb25zO1xuXG5cdGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsKSB7XG5cdFx0cmV0dXJuIGRlc3Ryb3lDaXJjdWxhcih7XG5cdFx0XHRmcm9tOiB2YWx1ZSxcblx0XHRcdHNlZW46IFtdLFxuXHRcdFx0Zm9yY2VFbnVtZXJhYmxlOiB0cnVlLFxuXHRcdFx0bWF4RGVwdGgsXG5cdFx0XHRkZXB0aDogMFxuXHRcdH0pO1xuXHR9XG5cblx0Ly8gUGVvcGxlIHNvbWV0aW1lcyB0aHJvdyB0aGluZ3MgYmVzaWRlcyBFcnJvciBvYmplY3Rz4oCmXG5cdGlmICh0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbicpIHtcblx0XHQvLyBgSlNPTi5zdHJpbmdpZnkoKWAgZGlzY2FyZHMgZnVuY3Rpb25zLiBXZSBkbyB0b28sIHVubGVzcyBhIGZ1bmN0aW9uIGlzIHRocm93biBkaXJlY3RseS5cblx0XHRyZXR1cm4gYFtGdW5jdGlvbjogJHsodmFsdWUubmFtZSB8fCAnYW5vbnltb3VzJyl9XWA7XG5cdH1cblxuXHRyZXR1cm4gdmFsdWU7XG59O1xuXG5jb25zdCBkZXNlcmlhbGl6ZUVycm9yID0gKHZhbHVlLCBvcHRpb25zID0ge30pID0+IHtcblx0Y29uc3Qge21heERlcHRoID0gTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZfSA9IG9wdGlvbnM7XG5cblx0aWYgKHZhbHVlIGluc3RhbmNlb2YgRXJyb3IpIHtcblx0XHRyZXR1cm4gdmFsdWU7XG5cdH1cblxuXHRpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcblx0XHRjb25zdCBuZXdFcnJvciA9IG5ldyBFcnJvcigpOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIHVuaWNvcm4vZXJyb3ItbWVzc2FnZVxuXHRcdGRlc3Ryb3lDaXJjdWxhcih7XG5cdFx0XHRmcm9tOiB2YWx1ZSxcblx0XHRcdHNlZW46IFtdLFxuXHRcdFx0dG9fOiBuZXdFcnJvcixcblx0XHRcdG1heERlcHRoLFxuXHRcdFx0ZGVwdGg6IDBcblx0XHR9KTtcblx0XHRyZXR1cm4gbmV3RXJyb3I7XG5cdH1cblxuXHRyZXR1cm4gbmV3IE5vbkVycm9yKHZhbHVlKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXHRzZXJpYWxpemVFcnJvcixcblx0ZGVzZXJpYWxpemVFcnJvclxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuY29uc3QgZ2V0VW5pcXVlSWQgPSAoKSA9PiBgJHtEYXRlLm5vdygpfS0ke01hdGgucmFuZG9tKCl9YDtcblxuY29uc3QgZ2V0U2VuZENoYW5uZWwgPSBjaGFubmVsID0+IGAlYmV0dGVyLWlwYy1zZW5kLWNoYW5uZWwtJHtjaGFubmVsfWA7XG5jb25zdCBnZXRSZW5kZXJlclNlbmRDaGFubmVsID0gY2hhbm5lbCA9PiBgJWJldHRlci1pcGMtc2VuZC1jaGFubmVsLSR7Y2hhbm5lbH1gO1xuXG5tb2R1bGUuZXhwb3J0cy5jdXJyZW50V2luZG93Q2hhbm5lbCA9ICclYmV0dGVyLWlwYy1jdXJyZW50LXdpbmRvdyc7XG5cbm1vZHVsZS5leHBvcnRzLmdldFNlbmRDaGFubmVsID0gZ2V0U2VuZENoYW5uZWw7XG5tb2R1bGUuZXhwb3J0cy5nZXRSZW5kZXJlclNlbmRDaGFubmVsID0gZ2V0UmVuZGVyZXJTZW5kQ2hhbm5lbDtcblxubW9kdWxlLmV4cG9ydHMuZ2V0UmVzcG9uc2VDaGFubmVscyA9IGNoYW5uZWwgPT4ge1xuXHRjb25zdCBpZCA9IGdldFVuaXF1ZUlkKCk7XG5cdHJldHVybiB7XG5cdFx0c2VuZENoYW5uZWw6IGdldFNlbmRDaGFubmVsKGNoYW5uZWwpLFxuXHRcdGRhdGFDaGFubmVsOiBgJWJldHRlci1pcGMtcmVzcG9uc2UtZGF0YS1jaGFubmVsLSR7Y2hhbm5lbH0tJHtpZH1gLFxuXHRcdGVycm9yQ2hhbm5lbDogYCViZXR0ZXItaXBjLXJlc3BvbnNlLWVycm9yLWNoYW5uZWwtJHtjaGFubmVsfS0ke2lkfWBcblx0fTtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmdldFJlbmRlcmVyUmVzcG9uc2VDaGFubmVscyA9IGNoYW5uZWwgPT4ge1xuXHRjb25zdCBpZCA9IGdldFVuaXF1ZUlkKCk7XG5cdHJldHVybiB7XG5cdFx0c2VuZENoYW5uZWw6IGdldFJlbmRlcmVyU2VuZENoYW5uZWwoY2hhbm5lbCksXG5cdFx0ZGF0YUNoYW5uZWw6IGAlYmV0dGVyLWlwYy1yZXNwb25zZS1kYXRhLWNoYW5uZWwtJHtjaGFubmVsfS0ke2lkfWAsXG5cdFx0ZXJyb3JDaGFubmVsOiBgJWJldHRlci1pcGMtcmVzcG9uc2UtZXJyb3ItY2hhbm5lbC0ke2NoYW5uZWx9LSR7aWR9YFxuXHR9O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcbmNvbnN0IGVsZWN0cm9uID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcbmNvbnN0IHtzZXJpYWxpemVFcnJvciwgZGVzZXJpYWxpemVFcnJvcn0gPSByZXF1aXJlKCdzZXJpYWxpemUtZXJyb3InKTtcbmNvbnN0IHV0aWwgPSByZXF1aXJlKCcuL3V0aWwuanMnKTtcblxuY29uc3Qge2lwY1JlbmRlcmVyfSA9IGVsZWN0cm9uO1xuY29uc3QgaXBjID0gT2JqZWN0LmNyZWF0ZShpcGNSZW5kZXJlciB8fCB7fSk7XG5cbmlwYy5jYWxsTWFpbiA9IChjaGFubmVsLCBkYXRhKSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdGNvbnN0IHtzZW5kQ2hhbm5lbCwgZGF0YUNoYW5uZWwsIGVycm9yQ2hhbm5lbH0gPSB1dGlsLmdldFJlc3BvbnNlQ2hhbm5lbHMoY2hhbm5lbCk7XG5cblx0Y29uc3QgY2xlYW51cCA9ICgpID0+IHtcblx0XHRpcGNSZW5kZXJlci5vZmYoZGF0YUNoYW5uZWwsIG9uRGF0YSk7XG5cdFx0aXBjUmVuZGVyZXIub2ZmKGVycm9yQ2hhbm5lbCwgb25FcnJvcik7XG5cdH07XG5cblx0Y29uc3Qgb25EYXRhID0gKF9ldmVudCwgcmVzdWx0KSA9PiB7XG5cdFx0Y2xlYW51cCgpO1xuXHRcdHJlc29sdmUocmVzdWx0KTtcblx0fTtcblxuXHRjb25zdCBvbkVycm9yID0gKF9ldmVudCwgZXJyb3IpID0+IHtcblx0XHRjbGVhbnVwKCk7XG5cdFx0cmVqZWN0KGRlc2VyaWFsaXplRXJyb3IoZXJyb3IpKTtcblx0fTtcblxuXHRpcGNSZW5kZXJlci5vbmNlKGRhdGFDaGFubmVsLCBvbkRhdGEpO1xuXHRpcGNSZW5kZXJlci5vbmNlKGVycm9yQ2hhbm5lbCwgb25FcnJvcik7XG5cblx0Y29uc3QgY29tcGxldGVEYXRhID0ge1xuXHRcdGRhdGFDaGFubmVsLFxuXHRcdGVycm9yQ2hhbm5lbCxcblx0XHR1c2VyRGF0YTogZGF0YVxuXHR9O1xuXG5cdGlwY1JlbmRlcmVyLnNlbmQoc2VuZENoYW5uZWwsIGNvbXBsZXRlRGF0YSk7XG59KTtcblxuaXBjLmFuc3dlck1haW4gPSAoY2hhbm5lbCwgY2FsbGJhY2spID0+IHtcblx0Y29uc3Qgc2VuZENoYW5uZWwgPSB1dGlsLmdldFJlbmRlcmVyU2VuZENoYW5uZWwoY2hhbm5lbCk7XG5cblx0Y29uc3QgbGlzdGVuZXIgPSBhc3luYyAoX2V2ZW50LCBkYXRhKSA9PiB7XG5cdFx0Y29uc3Qge2RhdGFDaGFubmVsLCBlcnJvckNoYW5uZWwsIHVzZXJEYXRhfSA9IGRhdGE7XG5cblx0XHR0cnkge1xuXHRcdFx0aXBjUmVuZGVyZXIuc2VuZChkYXRhQ2hhbm5lbCwgYXdhaXQgY2FsbGJhY2sodXNlckRhdGEpKTtcblx0XHR9IGNhdGNoIChlcnJvcikge1xuXHRcdFx0aXBjUmVuZGVyZXIuc2VuZChlcnJvckNoYW5uZWwsIHNlcmlhbGl6ZUVycm9yKGVycm9yKSk7XG5cdFx0fVxuXHR9O1xuXG5cdGlwY1JlbmRlcmVyLm9uKHNlbmRDaGFubmVsLCBsaXN0ZW5lcik7XG5cblx0cmV0dXJuICgpID0+IHtcblx0XHRpcGNSZW5kZXJlci5vZmYoc2VuZENoYW5uZWwsIGxpc3RlbmVyKTtcblx0fTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gaXBjO1xuIiwiJ3VzZSBzdHJpY3QnO1xuY29uc3QgZWxlY3Ryb24gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xuY29uc3Qge3NlcmlhbGl6ZUVycm9yLCBkZXNlcmlhbGl6ZUVycm9yfSA9IHJlcXVpcmUoJ3NlcmlhbGl6ZS1lcnJvcicpO1xuY29uc3QgdXRpbCA9IHJlcXVpcmUoJy4vdXRpbC5qcycpO1xuXG5jb25zdCB7aXBjTWFpbiwgQnJvd3NlcldpbmRvd30gPSBlbGVjdHJvbjtcbmNvbnN0IGlwYyA9IE9iamVjdC5jcmVhdGUoaXBjTWFpbiB8fCB7fSk7XG5cbmlwYy5jYWxsUmVuZGVyZXIgPSAoYnJvd3NlcldpbmRvdywgY2hhbm5lbCwgZGF0YSkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuXHRpZiAoIWJyb3dzZXJXaW5kb3cpIHtcblx0XHR0aHJvdyBuZXcgRXJyb3IoJ0Jyb3dzZXIgd2luZG93IHJlcXVpcmVkJyk7XG5cdH1cblxuXHRjb25zdCB7c2VuZENoYW5uZWwsIGRhdGFDaGFubmVsLCBlcnJvckNoYW5uZWx9ID0gdXRpbC5nZXRSZW5kZXJlclJlc3BvbnNlQ2hhbm5lbHMoY2hhbm5lbCk7XG5cblx0Y29uc3QgY2xlYW51cCA9ICgpID0+IHtcblx0XHRpcGNNYWluLm9mZihkYXRhQ2hhbm5lbCwgb25EYXRhKTtcblx0XHRpcGNNYWluLm9mZihlcnJvckNoYW5uZWwsIG9uRXJyb3IpO1xuXHR9O1xuXG5cdGNvbnN0IG9uRGF0YSA9IChldmVudCwgcmVzdWx0KSA9PiB7XG5cdFx0Y29uc3Qgd2luZG93ID0gQnJvd3NlcldpbmRvdy5mcm9tV2ViQ29udGVudHMoZXZlbnQuc2VuZGVyKTtcblx0XHRpZiAod2luZG93LmlkID09PSBicm93c2VyV2luZG93LmlkKSB7XG5cdFx0XHRjbGVhbnVwKCk7XG5cdFx0XHRyZXNvbHZlKHJlc3VsdCk7XG5cdFx0fVxuXHR9O1xuXG5cdGNvbnN0IG9uRXJyb3IgPSAoZXZlbnQsIGVycm9yKSA9PiB7XG5cdFx0Y29uc3Qgd2luZG93ID0gQnJvd3NlcldpbmRvdy5mcm9tV2ViQ29udGVudHMoZXZlbnQuc2VuZGVyKTtcblx0XHRpZiAod2luZG93LmlkID09PSBicm93c2VyV2luZG93LmlkKSB7XG5cdFx0XHRjbGVhbnVwKCk7XG5cdFx0XHRyZWplY3QoZGVzZXJpYWxpemVFcnJvcihlcnJvcikpO1xuXHRcdH1cblx0fTtcblxuXHRpcGNNYWluLm9uKGRhdGFDaGFubmVsLCBvbkRhdGEpO1xuXHRpcGNNYWluLm9uKGVycm9yQ2hhbm5lbCwgb25FcnJvcik7XG5cblx0Y29uc3QgY29tcGxldGVEYXRhID0ge1xuXHRcdGRhdGFDaGFubmVsLFxuXHRcdGVycm9yQ2hhbm5lbCxcblx0XHR1c2VyRGF0YTogZGF0YVxuXHR9O1xuXG5cdGlmIChicm93c2VyV2luZG93LndlYkNvbnRlbnRzKSB7XG5cdFx0YnJvd3NlcldpbmRvdy53ZWJDb250ZW50cy5zZW5kKHNlbmRDaGFubmVsLCBjb21wbGV0ZURhdGEpO1xuXHR9XG59KTtcblxuaXBjLmNhbGxGb2N1c2VkUmVuZGVyZXIgPSBhc3luYyAoLi4uYXJncykgPT4ge1xuXHRjb25zdCBmb2N1c2VkV2luZG93ID0gQnJvd3NlcldpbmRvdy5nZXRGb2N1c2VkV2luZG93KCk7XG5cdGlmICghZm9jdXNlZFdpbmRvdykge1xuXHRcdHRocm93IG5ldyBFcnJvcignTm8gYnJvd3NlciB3aW5kb3cgaW4gZm9jdXMnKTtcblx0fVxuXG5cdHJldHVybiBpcGMuY2FsbFJlbmRlcmVyKGZvY3VzZWRXaW5kb3csIC4uLmFyZ3MpO1xufTtcblxuaXBjLmFuc3dlclJlbmRlcmVyID0gKGJyb3dzZXJXaW5kb3dPckNoYW5uZWwsIGNoYW5uZWxPckNhbGxiYWNrLCBjYWxsYmFja09yTm90aGluZykgPT4ge1xuXHRsZXQgd2luZG93O1xuXHRsZXQgY2hhbm5lbDtcblx0bGV0IGNhbGxiYWNrO1xuXG5cdGlmIChjYWxsYmFja09yTm90aGluZyA9PT0gdW5kZWZpbmVkKSB7XG5cdFx0Y2hhbm5lbCA9IGJyb3dzZXJXaW5kb3dPckNoYW5uZWw7XG5cdFx0Y2FsbGJhY2sgPSBjaGFubmVsT3JDYWxsYmFjaztcblx0fSBlbHNlIHtcblx0XHR3aW5kb3cgPSBicm93c2VyV2luZG93T3JDaGFubmVsO1xuXHRcdGNoYW5uZWwgPSBjaGFubmVsT3JDYWxsYmFjaztcblx0XHRjYWxsYmFjayA9IGNhbGxiYWNrT3JOb3RoaW5nO1xuXG5cdFx0aWYgKCF3aW5kb3cpIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcignQnJvd3NlciB3aW5kb3cgcmVxdWlyZWQnKTtcblx0XHR9XG5cdH1cblxuXHRjb25zdCBzZW5kQ2hhbm5lbCA9IHV0aWwuZ2V0U2VuZENoYW5uZWwoY2hhbm5lbCk7XG5cblx0Y29uc3QgbGlzdGVuZXIgPSBhc3luYyAoZXZlbnQsIGRhdGEpID0+IHtcblx0XHRjb25zdCBicm93c2VyV2luZG93ID0gQnJvd3NlcldpbmRvdy5mcm9tV2ViQ29udGVudHMoZXZlbnQuc2VuZGVyKTtcblxuXHRcdGlmICh3aW5kb3cgJiYgd2luZG93LmlkICE9PSBicm93c2VyV2luZG93LmlkKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0Y29uc3Qgc2VuZCA9IChjaGFubmVsLCBkYXRhKSA9PiB7XG5cdFx0XHRpZiAoIShicm93c2VyV2luZG93ICYmIGJyb3dzZXJXaW5kb3cuaXNEZXN0cm95ZWQoKSkpIHtcblx0XHRcdFx0ZXZlbnQuc2VuZGVyLnNlbmQoY2hhbm5lbCwgZGF0YSk7XG5cdFx0XHR9XG5cdFx0fTtcblxuXHRcdGNvbnN0IHtkYXRhQ2hhbm5lbCwgZXJyb3JDaGFubmVsLCB1c2VyRGF0YX0gPSBkYXRhO1xuXG5cdFx0dHJ5IHtcblx0XHRcdHNlbmQoZGF0YUNoYW5uZWwsIGF3YWl0IGNhbGxiYWNrKHVzZXJEYXRhLCBicm93c2VyV2luZG93KSk7XG5cdFx0fSBjYXRjaCAoZXJyb3IpIHtcblx0XHRcdHNlbmQoZXJyb3JDaGFubmVsLCBzZXJpYWxpemVFcnJvcihlcnJvcikpO1xuXHRcdH1cblx0fTtcblxuXHRpcGNNYWluLm9uKHNlbmRDaGFubmVsLCBsaXN0ZW5lcik7XG5cblx0cmV0dXJuICgpID0+IHtcblx0XHRpcGNNYWluLm9mZihzZW5kQ2hhbm5lbCwgbGlzdGVuZXIpO1xuXHR9O1xufTtcblxuaXBjLnNlbmRUb1JlbmRlcmVycyA9IChjaGFubmVsLCBkYXRhKSA9PiB7XG5cdGZvciAoY29uc3QgYnJvd3NlcldpbmRvdyBvZiBCcm93c2VyV2luZG93LmdldEFsbFdpbmRvd3MoKSkge1xuXHRcdGlmIChicm93c2VyV2luZG93LndlYkNvbnRlbnRzKSB7XG5cdFx0XHRicm93c2VyV2luZG93LndlYkNvbnRlbnRzLnNlbmQoY2hhbm5lbCwgZGF0YSk7XG5cdFx0fVxuXHR9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlwYztcbiIsIid1c2Ugc3RyaWN0JztcblxuaWYgKHByb2Nlc3MudHlwZSA9PT0gJ3JlbmRlcmVyJykge1xuXHRtb2R1bGUuZXhwb3J0cy5pcGNSZW5kZXJlciA9IHJlcXVpcmUoJy4vc291cmNlL3JlbmRlcmVyLmpzJyk7XG59IGVsc2Uge1xuXHRtb2R1bGUuZXhwb3J0cy5pcGNNYWluID0gcmVxdWlyZSgnLi9zb3VyY2UvbWFpbi5qcycpO1xufVxuIiwiaW1wb3J0IHsgY29udGV4dEJyaWRnZSwgY2xpcGJvYXJkIH0gZnJvbSAnZWxlY3Ryb24nO1xuaW1wb3J0IHsgaXBjUmVuZGVyZXIgfSBmcm9tICdlbGVjdHJvbi1iZXR0ZXItaXBjJztcbmltcG9ydCB7IGNvbnN0YW50cyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IGFjY2VzcyB9IGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuXG5jb25zdCBhcGlLZXkgPSAnZWxlY3Ryb24nO1xuLyoqXG4gKiBAc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9lbGVjdHJvbi9lbGVjdHJvbi9pc3N1ZXMvMjE0MzcjaXNzdWVjb21tZW50LTU3MzUyMjM2MFxuICovXG5jb25zdCBhcGkgPSB7XG4gIHBhdGgsXG4gIGNsaXBib2FyZCxcbiAgaXBjUmVuZGVyZXIsXG4gIGFjY2VzczogKGRpcikgPT4gYWNjZXNzKGRpciwgY29uc3RhbnRzLlJfT0sgfCBjb25zdGFudHMuV19PSyksXG4gIHZlcnNpb25zOiBwcm9jZXNzLnZlcnNpb25zLFxufTtcblxuaWYgKGltcG9ydC5tZXRhLmVudi5NT0RFICE9PSAndGVzdCcpIHtcbiAgLyoqXG4gICAqIFRoZSBcIk1haW4gV29ybGRcIiBpcyB0aGUgSmF2YVNjcmlwdCBjb250ZXh0IHRoYXQgeW91ciBtYWluIHJlbmRlcmVyIGNvZGUgcnVucyBpbi5cbiAgICogQnkgZGVmYXVsdCwgdGhlIHBhZ2UgeW91IGxvYWQgaW4geW91ciByZW5kZXJlciBleGVjdXRlcyBjb2RlIGluIHRoaXMgd29ybGQuXG4gICAqXG4gICAqIEBzZWUgaHR0cHM6Ly93d3cuZWxlY3Ryb25qcy5vcmcvZG9jcy9hcGkvY29udGV4dC1icmlkZ2VcbiAgICovXG4gIGNvbnRleHRCcmlkZ2UuZXhwb3NlSW5NYWluV29ybGQoYXBpS2V5LCBhcGkpO1xufSBlbHNlIHtcblxuICAvKipcbiAgICogUmVjdXJzaXZlbHkgT2JqZWN0LmZyZWV6ZSgpIG9uIG9iamVjdHMgYW5kIGZ1bmN0aW9uc1xuICAgKiBAc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9zdWJzdGFjay9kZWVwLWZyZWV6ZVxuICAgKiBAcGFyYW0gb2JqIE9iamVjdCBvbiB3aGljaCB0byBsb2NrIHRoZSBhdHRyaWJ1dGVzXG4gICAqL1xuICBjb25zdCBkZWVwRnJlZXplID0gKG9iaikgPT4ge1xuICAgIGlmICh0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyAmJiBvYmogIT09IG51bGwpIHtcbiAgICAgIE9iamVjdC5rZXlzKG9iaikuZm9yRWFjaCgocHJvcCkgPT4ge1xuICAgICAgICBjb25zdCB2YWwgPSBvYmpbcHJvcF07XG4gICAgICAgIGlmICgodHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIHZhbCA9PT0gJ2Z1bmN0aW9uJykgJiYgIU9iamVjdC5pc0Zyb3plbih2YWwpKSB7XG4gICAgICAgICAgZGVlcEZyZWV6ZSh2YWwpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gT2JqZWN0LmZyZWV6ZShvYmopO1xuICB9O1xuXG4gIGRlZXBGcmVlemUoYXBpKTtcblxuICB3aW5kb3dbYXBpS2V5XSA9IGFwaTtcblxuICAvLyBOZWVkIGZvciBTcGVjdHJvbiB0ZXN0c1xuICB3aW5kb3cuZWxlY3Ryb25SZXF1aXJlID0gcmVxdWlyZTtcbn1cbiJdLCJuYW1lcyI6WyJzZXJpYWxpemVFcnJvciIsImRlc2VyaWFsaXplRXJyb3IiLCJlbGVjdHJvbiIsInJlcXVpcmUkJDAiLCJyZXF1aXJlJCQxIiwidXRpbCIsInJlcXVpcmUkJDIiLCJpcGNSZW5kZXJlciIsImlwYyIsInBhdGgiLCJjbGlwYm9hcmQiLCJhY2Nlc3MiLCJjb25zdGFudHMiLCJjb250ZXh0QnJpZGdlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7O0FBRUEsdUJBQXVCLE1BQU07QUFBQSxFQUM1QixZQUFZLFNBQVM7QUFDcEIsVUFBTSxTQUFTLHFCQUFxQjtBQUNwQyxXQUFPLGVBQWUsTUFBTSxRQUFRO0FBQUEsTUFDbkMsT0FBTztBQUFBLE1BQ1AsY0FBYztBQUFBLE1BQ2QsVUFBVTtBQUFBO0FBR1gsUUFBSSxNQUFNLG1CQUFtQjtBQUM1QixZQUFNLGtCQUFrQixNQUFNO0FBQUE7QUFBQTtBQUFBLFNBSXpCLHFCQUFxQixTQUFTO0FBQ3BDLFFBQUk7QUFDSCxhQUFPLEtBQUssVUFBVTtBQUFBLFlBQ3JCO0FBQ0QsYUFBTyxPQUFPO0FBQUE7QUFBQTtBQUFBO0FBS2pCLE1BQU0sbUJBQW1CO0FBQUEsRUFDeEIsRUFBQyxVQUFVLFFBQVEsWUFBWTtBQUFBLEVBQy9CLEVBQUMsVUFBVSxXQUFXLFlBQVk7QUFBQSxFQUNsQyxFQUFDLFVBQVUsU0FBUyxZQUFZO0FBQUEsRUFDaEMsRUFBQyxVQUFVLFFBQVEsWUFBWTtBQUFBO0FBR2hDLE1BQU0sV0FBVyxPQUFPO0FBRXhCLE1BQU0sU0FBUyxVQUFRO0FBQ3RCLE9BQUssWUFBWTtBQUNqQixRQUFNLE9BQU8sS0FBSztBQUNsQixTQUFP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
