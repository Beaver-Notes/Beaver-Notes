import Store from 'electron-store';
import { app } from 'electron';

const schema = {
	dataDir: {
		type: 'string',
		default: app.getPath('userData'),
	},
};

export default new Store({ name: 'settings', schema, encryptionKey: process.env.VITE_ENCRYPT_KEY });
