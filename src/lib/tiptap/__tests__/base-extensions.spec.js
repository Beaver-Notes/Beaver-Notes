import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { extensions, yjsExtensions } from '../index.js';

// Regression: the live editor schema must contain the media nodes the
// insert/drop/convert paths reference (paper, pdfBlock) — a missing node
// surfaces only at runtime as `schema.nodes.X is undefined`.
describe('base editor extensions', () => {
  it.each([
    ['extensions', extensions],
    ['yjsExtensions', yjsExtensions],
  ])('%s registers paper and pdfBlock in the schema', (_name, list) => {
    const schema = getSchema(list);
    expect(schema.nodes.paper).toBeTruthy();
    expect(schema.nodes.pdfBlock).toBeTruthy();
  });
});
