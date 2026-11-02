import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateJSON } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Image from '../image';
import Video from '../video-block';
import Audio from '../audio-block';
import FileEmbed from '../file-block';

// Schema-only test: generateJSON runs the parse rules without an editor
// view, so NodeViews (and the components they render) never load.
vi.mock('@/store', () => ({ useStore: () => ({ activeNoteId: 'note-1' }) }));
vi.mock('@/utils/assets/storage.js', async (importOriginal) => {
  const actual = await importOriginal();
  const noop = vi.fn();
  return { ...actual, default: noop, writeImageFile: noop, saveFile: noop };
});
vi.mock('../video-block/VideoComponent.vue', () => ({ default: {} }));
vi.mock('../audio-block/AudioComponent.vue', () => ({ default: {} }));
vi.mock('../file-block/FileEmbedComponent.vue', () => ({ default: {} }));

const exts = [Document, Paragraph, Text, Image, Video, Audio, FileEmbed];

function nodesOfType(json, type) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === type) found.push(node);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(json);
  return found;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('schema-level media src gate (SC-4-02)', () => {
  it('drops images with unsafe src schemes, keeps legit ones', () => {
    const json = generateJSON(
      '<img src="file:///etc/passwd" alt="bad">' +
        '<img src="javascript:alert(1)" alt="worse">' +
        '<img src="assets://n1/ok.png" alt="ok">' +
        '<img src="https://example.com/remote.png" alt="remote">' +
        '<img src="data:image/png;base64,AAA=" alt="inline">',
      exts
    );
    const images = nodesOfType(json, 'image');
    expect(images.map((n) => n.attrs.src)).toEqual([
      'assets://n1/ok.png',
      'https://example.com/remote.png',
      'data:image/png;base64,AAA=',
    ]);
  });

  it('drops video nodes with unsafe src schemes, keeps legit ones', () => {
    const json = generateJSON(
      '<video src="file:///C:/x.mp4"></video>' +
        '<video src="assets://n1/ok.mp4"></video>' +
        '<video src="https://example.com/ok.mp4"></video>',
      exts
    );
    const videos = nodesOfType(json, 'Video');
    expect(videos.map((n) => n.attrs.src)).toEqual([
      'assets://n1/ok.mp4',
      'https://example.com/ok.mp4',
    ]);
  });

  it('keeps pending fileEmbeds (empty src) and inline data: payloads', () => {
    const json = generateJSON(
      '<span data-file-name="pending.pdf" data-src=""></span>' +
        '<span data-file-name="b.pdf" data-src="data:application/pdf;base64,AAA="></span>' +
        '<span data-file-name="evil.pdf" data-src="file:///etc/passwd"></span>' +
        '<span data-file-name="ok.pdf" data-src="assets://n1/ok.pdf"></span>',
      exts
    );
    const embeds = nodesOfType(json, 'fileEmbed');
    expect(embeds.map((n) => n.attrs.src)).toEqual([
      '',
      'data:application/pdf;base64,AAA=',
      'assets://n1/ok.pdf',
    ]);
    expect(JSON.stringify(json)).not.toContain('file:///etc/passwd');
  });

  it('attributes legacy spans to their own block type by extension', () => {
    // No data-block-name (old HTML / pre-fix copies): fileEmbed used to steal
    // every span regardless of type, so a pasted video became a file embed.
    const json = generateJSON(
      '<span data-file-name="clip.mp4" data-src="assets://n1/clip.mp4"></span>' +
        '<span data-file-name="song.mp3" data-src="assets://n1/song.mp3"></span>' +
        '<span data-file-name="ok.pdf" data-src="assets://n1/ok.pdf"></span>',
      exts
    );
    expect(nodesOfType(json, 'Video').map((n) => n.attrs.fileName)).toEqual([
      'clip.mp4',
    ]);
    expect(nodesOfType(json, 'Audio').map((n) => n.attrs.fileName)).toEqual([
      'song.mp3',
    ]);
    expect(nodesOfType(json, 'fileEmbed').map((n) => n.attrs.fileName)).toEqual(
      ['ok.pdf']
    );
  });

  it('declared data-block-name wins over the extension heuristic', () => {
    const json = generateJSON(
      '<span data-block-name="Video" data-file-name="odd.pdf" data-src="assets://n1/odd.pdf"></span>' +
        '<span data-block-name="fileEmbed" data-file-name="movie.mp4" data-src="assets://n1/movie.mp4"></span>',
      exts
    );
    expect(nodesOfType(json, 'Video').map((n) => n.attrs.fileName)).toEqual([
      'odd.pdf',
    ]);
    expect(nodesOfType(json, 'fileEmbed').map((n) => n.attrs.fileName)).toEqual(
      ['movie.mp4']
    );
  });

  it('drops Video data: payloads (media must not carry inline data)', () => {
    const json = generateJSON(
      '<video src="data:video/mp4;base64,AAA="></video>',
      exts
    );
    expect(nodesOfType(json, 'Video')).toHaveLength(0);
  });
});
