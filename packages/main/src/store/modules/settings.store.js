import Store from 'electron-store';
import { app } from 'electron';

const schema = {
  // Core
  dataDir: {
    type: 'string',
    default: app.getPath('userData'),
  },
  // Sync
  importDir: { type: 'string', default: '' },
  syncMetadata: { type: 'object', default: {} },
  deletedIds: { type: 'object', default: {} },
  deletedFolderIds: { type: 'object', default: {} },
  // Security / shared keys (stored as encrypted blobs)
  sharedKey: { type: 'string', default: '' },
  lockStatus: { type: 'object', default: {} },
  migration_completed: { type: 'boolean', default: false },
};

export default new Store({
  name: 'settings',
  schema,
  encryptionKey: process.env.VITE_ENCRYPT_KEY,
});
