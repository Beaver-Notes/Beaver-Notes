import emitter from 'tiny-emitter/instance';
import { CoreAccess } from './CoreAccess';

const APP_EVENTS = [
  'note-opened',
  'note-saved',
  'note-created',
  'note-deleted',
  'folder-created',
  'folder-deleted',
  'folder-updated',
  'label-created',
  'label-deleted',
  'label-updated',
  'app-focused',
  'app-blurred',
  'settings-changed',
];

const _emitter = emitter;

export function emitAppEvent(event, data) {
  if (!APP_EVENTS.includes(event)) {
    console.warn(`[PluginEvents] Unknown app event: "${event}"`);
    return;
  }
  _emitter.emit(`plugin:${event}`, data);
}

export function createPluginEvents(pluginId) {
  const listeners = [];

  function on(event, callback) {
    if (!APP_EVENTS.includes(event)) {
      console.warn(`[PluginEvents] Unknown app event: "${event}"`);
      return () => {};
    }

    const dataEvents = [
      'note-opened',
      'note-saved',
      'note-created',
      'note-deleted',
      'folder-created',
      'folder-deleted',
      'folder-updated',
      'label-created',
      'label-deleted',
      'label-updated',
    ];

    let wrappedCallback = callback;

    if (dataEvents.includes(event)) {
      wrappedCallback = (data) => {
        try {
          CoreAccess.guard(pluginId, 'notes:read', () => callback(data));
        } catch {
          // silently drop events for which plugin lacks permission
        }
      };
    }

    const eventName = `plugin:${event}`;
    _emitter.on(eventName, wrappedCallback);
    listeners.push({ event: eventName, callback: wrappedCallback });
    return () => off(event, callback);
  }

  function once(event, callback) {
    const eventName = `plugin:${event}`;
    _emitter.once(eventName, callback);
    listeners.push({ event: eventName, callback });
    return () => off(event, callback);
  }

  function off(event, callback) {
    const eventName = `plugin:${event}`;
    _emitter.off(eventName, callback);
    const index = listeners.findIndex(
      (l) => l.event === eventName && l.callback === callback
    );
    if (index !== -1) listeners.splice(index, 1);
  }

  function destroy() {
    for (const { event, callback } of listeners) {
      _emitter.off(event, callback);
    }
    listeners.length = 0;
  }

  return { on, once, off, destroy };
}
