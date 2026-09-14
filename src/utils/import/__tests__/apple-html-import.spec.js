import { describe, it, expect } from 'vitest';
import { htmlToTiptap } from '../bulkImport.js';

// Apple Notes bodies arrive as HTML: blocks wrapped in <div>, tables and
// attachments wrapped in <object>. These guards keep imports from going
// blank (bare text in listItem is invalid ProseMirror) or showing raw markup.
describe('apple html import', () => {
  it('keeps div-wrapped lists as valid blocks', () => {
    const out = htmlToTiptap(
      '<div>Shopping</div><div><ul><li>apples</li><li>milk</li></ul></div>' +
        '<div><ol><li>first</li><li>second</li></ol></div>',
      'n1',
      '/tmp'
    );
    const lists = out.content.filter((n) =>
      ['bulletList', 'orderedList'].includes(n.type)
    );
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(list.content).toHaveLength(2);
      for (const item of list.content) {
        expect(item.type).toBe('listItem');
        for (const child of item.content) {
          expect(child.type).not.toBe('text');
        }
      }
    }
  });

  it('unwraps object containers instead of dumping raw markup', () => {
    const out = htmlToTiptap(
      '<div>Backend</div><div><object><table><tbody>' +
        '<tr><td>Feature</td><td>Free</td></tr>' +
        '</tbody></table></object></div>' +
        '<div><object data="x" type="image/jpeg"></object></div>',
      'n1',
      '/tmp'
    );
    expect(out.content.some((n) => n.type === 'table')).toBe(true);
    expect(JSON.stringify(out)).not.toContain('<object>');
  });
});
