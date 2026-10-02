// src/lib/share/htmlToTiptap.ts
import { generateJSON, type Extensions } from '@tiptap/core';
import { extensions } from '@/lib/tiptap';

export function htmlToTiptap(html: string) {
  return generateJSON(html, extensions as Extensions);
}
