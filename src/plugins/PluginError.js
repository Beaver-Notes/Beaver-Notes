export class PluginPermissionError extends Error {
  constructor(pluginId, permission) {
    super(`Plugin "${pluginId}" lacks permission "${permission}"`);
    this.name = 'PluginPermissionError';
    this.pluginId = pluginId;
    this.permission = permission;
  }
}

export class PluginValidationError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'PluginValidationError';
    this.cause = cause;
  }
}

export class PluginLoadError extends Error {
  constructor(pluginId, message, cause) {
    super(`Failed to load plugin "${pluginId}": ${message}`);
    this.name = 'PluginLoadError';
    this.pluginId = pluginId;
    this.cause = cause;
  }
}

export class PluginDuplicateError extends Error {
  constructor(pluginId) {
    super(`Plugin "${pluginId}" is already installed`);
    this.name = 'PluginDuplicateError';
    this.pluginId = pluginId;
  }
}

export class PluginConflictError extends Error {
  constructor(pluginId, kind, name, existingPluginId) {
    super(
      `Plugin "${pluginId}" conflicts with "${existingPluginId}": ${kind} "${name}" is already registered`
    );
    this.name = 'PluginConflictError';
    this.pluginId = pluginId;
    this.conflictingPluginId = existingPluginId;
    this.kind = kind;
    this.name_ = name;
  }
}

export class PluginBusyError extends Error {
  constructor(pluginId, operation) {
    super(
      `Plugin "${pluginId}" is busy (${operation} in progress); retry later`
    );
    this.name = 'PluginBusyError';
    this.pluginId = pluginId;
    this.operation = operation;
  }
}

export class PluginUpdateError extends Error {
  constructor(pluginId, message) {
    super(`Cannot update plugin "${pluginId}": ${message}`);
    this.name = 'PluginUpdateError';
    this.pluginId = pluginId;
  }
}

export class PluginStorageError extends Error {
  constructor(pluginId, message) {
    super(`Plugin "${pluginId}" storage error: ${message}`);
    this.name = 'PluginStorageError';
    this.pluginId = pluginId;
  }
}
