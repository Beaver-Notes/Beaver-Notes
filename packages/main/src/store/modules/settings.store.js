import Store from 'electron-store';
import { app } from 'electron';

const schema = {
	dataDir: {
		type: 'string',
		default: app.getPath('userData'),
	},
  authRecords: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
        },
        clientId: {
          type: 'string',
        },
        expiredTime: {
          type: 'number',
        },
        createdAt: {
          type: 'number',
        },
        platform: {
          type: 'string',
        },
        name: {
          type: 'string',
        },
        // authorizated permissions
        auth: {
          type: 'string',
        },
        // 1 active 0 inactive
        status: {
          type: 'number',
          default: 0,
        },
      },
      default: [],
    },
  },
};

export default new Store({ name: 'settings', schema, encryptionKey: process.env.VITE_ENCRYPT_KEY });
