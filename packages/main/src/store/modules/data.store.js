/* eslint-disable no-mixed-spaces-and-tabs */
import Store from 'electron-store';

const schema = {
	notes: {
		type: 'object',
    patternProperties: {
      '[A-Za-z0-9_-]': {
      	type: 'object',
      	properties: {
      		id: { type: 'string', default: '' },
      		title: { type: 'string', default: '' },
      		content: { type: 'object', default: { type: 'doc', content: [] } },
      		labels: { type: 'array', default: [] },
      		createdAt: { type: 'number', default: Date.now() },
      		updatedAt: { type: 'number', default: Date.now() },
      		isBookmarked: { type: 'boolean', default: false },
      		isArchived: { type: 'boolean', default: false },
          lastCursorPosition: { type: 'number', default: 0 },
      	},
      },
    },
	},
  labels: {
    type: 'array',
  },
};

const store = new Store({
	schema,
  encryptionKey: import.meta.env.VITE_ENCRYPT_KEY,
});

// store.onDidChange('notes', (value) => {
//   console.log(value);
// });

export default store;
