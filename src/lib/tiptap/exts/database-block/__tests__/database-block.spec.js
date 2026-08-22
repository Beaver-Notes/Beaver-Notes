import { describe, it, expect } from 'vitest';
import { Editor, generateHTML, generateJSON } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import { DatabaseBlock } from '../index';

const extensions = [Document, Text, Paragraph, DatabaseBlock];

describe('databaseBlock node', () => {
  it('parses data-database-id / data-view-id into attrs', () => {
    const json = generateJSON(
      '<div data-type="databaseBlock" data-database-id="abc" data-view-id="v1"></div>',
      extensions
    );
    const node = json.content[0];
    expect(node.type).toBe('databaseBlock');
    expect(node.attrs.databaseId).toBe('abc');
    expect(node.attrs.viewId).toBe('v1');
  });

  it('serializes attrs back to html (round trip)', () => {
    const html = generateHTML(
      {
        type: 'doc',
        content: [
          {
            type: 'databaseBlock',
            attrs: { databaseId: 'abc', viewId: null },
          },
        ],
      },
      extensions
    );
    expect(html).toBe('<div data-type="databaseBlock" data-database-id="abc"></div>');
  });

  it('registers setDatabaseBlock and replaces the selection', () => {
    const editor = new Editor({ extensions });
    expect(typeof editor.commands.setDatabaseBlock).toBe('function');
    expect(editor.commands.setDatabaseBlock({ databaseId: 'db1' })).toBe(true);
    const first = editor.state.doc.firstChild;
    expect(first.type.name).toBe('databaseBlock');
    expect(first.attrs.databaseId).toBe('db1');
  });
});
