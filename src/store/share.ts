// src/store/share.ts
import { defineStore } from 'pinia';
import { nanoid } from 'nanoid';
import { useNoteStore } from './note';
import { extractFromUrl, extractedToNote } from '@/lib/share/extractContent';
import { importSharedFile } from '@/lib/share/importFile';
import { htmlToTiptap } from '@/lib/share/htmlToTiptap';
import { createTextContent, guessShareKind, extractFirstUrl } from '@/lib/share/parse';
import { invokeCommand } from '@/lib/tauri/commands';
import { notify } from '@/lib/native/app';
import { base64ToBuf, bufToBase64 } from '@/utils/crypto/codec.js';

// Shown in the preview modal when the requested append target cannot be
// honored (deleted/locked/mismatched): the save forks to a new note, announced.
export const INVALID_TARGET_NOTICE = 'Original note unavailable — will save as new note';

// Two-store split for the last-folder smart default: the iOS extension
// persists its own copy in UserDefaults ('beaver.lastFolderId') and the host
// persists its own copy here in localStorage. They can't share storage
// (extension sandbox vs webview), so last-write-wins per surface is accepted:
// every save on either surface overwrites that surface's copy, and each
// surface only ever reads its own.
const LAST_SHARE_FOLDER_KEY = 'beaver.lastShareFolderId';

function readLastShareFolderId(): string | null {
  try {
    return localStorage.getItem(LAST_SHARE_FOLDER_KEY);
  } catch {
    return null;
  }
}

function writeLastShareFolderId(folderId: string | null) {
  try {
    if (folderId) localStorage.setItem(LAST_SHARE_FOLDER_KEY, folderId);
    else localStorage.removeItem(LAST_SHARE_FOLDER_KEY);
  } catch {}
}

export interface ShareItem {
  id: string;
  url: string;
  title: string;
  text: string;
  kind: string;
  // ponytail: iOS extension sends no mime_type (defaults to None in Rust); always optional
  mimeType: string | null;
  filePaths: string[];
  folderId: string | null;
  workspaceId: string | null;
  targetNoteId: string | null;
  contentMode: string;
  confirmed: boolean;
  extracted: any;
  error: string | null;
  offline: boolean;
}

function guessImageMime(mimeType: string | null, filePath: string): string {
  if (mimeType?.startsWith('image/')) return mimeType;
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

function docContent(content: any): any[] {
  const inner = (content as any)?.content;
  return Array.isArray(inner) ? inner : [];
}

async function readSharedBytes(filePath: string): Promise<Uint8Array> {
  // fs scope denies Group Containers on iOS: try container-scoped
  // read_shared_file first, fall back to fs:readData (Android/desktop).
  // Both deliver binary as base64; decode first.
  let raw: unknown;
  try {
    raw = await invokeCommand('read_shared_file', { path: filePath });
  } catch {
    raw = await invokeCommand('fs:readData', { path: filePath });
  }
  return typeof raw === 'string' ? base64ToBuf(raw) : (raw as Uint8Array);
}

function baseName(filePath: string): string {
  return filePath.split('/').pop() || 'file';
}

function normalize(raw: any): ShareItem {
  const item = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const mimeType = item.mime_type ?? item.mimeType ?? null;
  const filePaths = item.file_paths ?? item.filePaths ?? [];
  const kind =
    item.kind ||
    guessShareKind({
      url: item.url || null,
      text: item.text || null,
      mimeType: mimeType || null,
      filePath: (Array.isArray(filePaths) ? filePaths[0] : filePaths) || null,
    });
  return {
    id: item.id || nanoid(),
    url: item.url || extractFirstUrl(item.text || '') || '',
    title: item.title || '',
    text: item.text || '',
    kind,
    mimeType,
    filePaths: Array.isArray(filePaths) ? filePaths : filePaths ? [filePaths] : [],
    folderId: item.folder_id || item.folderId || null,
    workspaceId: item.workspace_id || item.workspaceId || null,
    targetNoteId: item.target_note_id || item.targetNoteId || null,
    contentMode: item.content_mode || item.contentMode || 'full',
    confirmed: item.confirmed ?? false,
    extracted: null,
    error: null,
    offline: false,
  };
}

export const useShareStore = defineStore('share', {
  state: () => ({ items: [] as ShareItem[], isOpen: false, busy: false, folderId: null as string | null, workspaceId: null as string | null, notice: null as string | null }),
  getters: { current: (s) => s.items[0] || null },
  actions: {
    openWithItems(rawItems: any[]) {
      this.items = rawItems.map(normalize);
      // HONOR the selection made inside the OS share sheet, if the user made one.
      // Otherwise (unconfirmed/modal shares only — a sheet-confirmed save already
      // resolved the folder, including an explicit none) fall back to the last
      // folder saved from this surface. Stale ids are safe: noteStore.add
      // resolves unknown folders to null via resolveFolderId.
      const explicitFolderId = this.items.find((i) => i.folderId)?.folderId || null;
      const sheetResolved = this.items.some((i) => i.confirmed);
      this.folderId = explicitFolderId || (!sheetResolved ? readLastShareFolderId() : null);
      this.workspaceId = this.items.find((i) => i.workspaceId)?.workspaceId || null;
      this.notice = null;
      this.validateTarget();
      this.isOpen = true;
      this.items.forEach((i) => this.hydrateItem(i));
    },
    // True when every item targets the same existing, unlocked note. Otherwise
    // sets notice (when any target was requested) so the modal announces the
    // new-note fallback instead of forking silently. No target at all is a
    // plain new-note save: valid, no notice.
    validateTarget() {
      const first = this.items[0]?.targetNoteId || null;
      const uniform = !!first && this.items.every((i) => i.targetNoteId === first);
      const noteStore = useNoteStore();
      const existing = first ? (noteStore.data as any)[first] : null;
      if (uniform && existing && !existing.isLocked) {
        this.notice = null;
        return true;
      }
      if (!this.items.some((i) => i.targetNoteId)) {
        this.notice = null;
        return true;
      }
      this.notice = INVALID_TARGET_NOTICE;
      return false;
    },
    // Single save contract (both drain fast-path and modal confirm use it):
    // notify via the existing OS-notification infra; never throws, so a
    // denied permission or missing daemon cannot break the save.
    async announceSave(note: any) {
      try {
        await notify({ title: `Saved to ${note?.title || 'note'}`, body: 'Beaver Notes' });
      } catch {}
    },
    async hydrateItem(item: ShareItem) {
      try {
        this.busy = true;
        if (item.kind === 'url' && item.url) {
          // Link-only shares skip extraction: title+url body via buildContent, no network.
          if (item.contentMode !== 'link') {
            try {
              const extracted = await extractFromUrl(item.url);
              if (!item.targetNoteId && extracted.markdown) {
                // New-note path: Defuddle markdown through the .md importer
                // (same shape as the file branch; buildContent prefers it).
                // Append targets keep legacy contentHtml → htmlToTiptap.
                const note = await extractedToNote(extracted, item.url);
                item.extracted = { title: note.title || extracted.title, content: note.content as any };
              } else {
                item.extracted = extracted;
              }
            } catch {
              item.offline = true; // save raw now, extract later (global constraint)
            }
          }
        } else if (item.kind === 'file' && item.filePaths.length) {
          // One share action may carry N files (iOS appends every
          // attachment; Android SEND_MULTIPLE arrives as one PendingShare):
          // import each in order. importSharedFile keeps unknown extensions
          // as fileEmbed nodes, so every path contributes; per-file failures
          // skip that file, and an all-failed share keeps the old error.
          const blocks: any[] = [];
          let title = '';
          let lastError: unknown = null;
          for (const filePath of item.filePaths) {
            try {
              const res = await importSharedFile({
                fileName: baseName(filePath),
                data: await readSharedBytes(filePath),
              });
              if (!title && res.title) title = res.title;
              blocks.push(...docContent(res.content));
            } catch (e) {
              lastError = e;
            }
          }
          if (!blocks.length) throw lastError ?? new Error('Empty shared file');
          item.extracted = { title, content: { type: 'doc', content: blocks } };
        } else if (item.kind === 'image' && item.filePaths.length) {
          // Same read+decode as the file branch, but never via
          // importSharedFile (images need image nodes, not the keep-as-file
          // fallback). Embed every path as a TipTap image node with a data: URL (sanitizeNoteContent
          // allows data: for images); assets:// would need a note id that
          // does not exist until saveAll creates the note.
          const blocks: any[] = [];
          let fileTitle = '';
          let lastError: unknown = null;
          for (const filePath of item.filePaths) {
            try {
              const bytes = await readSharedBytes(filePath);
              if (!bytes.length) throw new Error('Empty image share');
              const mime = guessImageMime(item.mimeType, filePath);
              const name = baseName(filePath);
              if (!fileTitle) fileTitle = name;
              const alt = item.title || name || 'Shared image';
              blocks.push({
                type: 'image',
                attrs: { src: `data:${mime};base64,${bufToBase64(bytes)}`, alt },
              });
            } catch (e) {
              lastError = e;
            }
          }
          if (!blocks.length) throw lastError ?? new Error('Empty image share');
          item.extracted = {
            title: item.title || fileTitle || 'Shared image',
            content: { type: 'doc', content: blocks },
          };
        }
      } catch (e) {
        item.error = String(e);
      } finally {
        this.busy = false;
      }
    },
    buildContent(item: ShareItem) {
      // Text accompanying a URL survives: sheet captions sit above the
      // extraction. Link-mode shares skip extraction, so they already carry
      // text via the fallback below — nothing to prepend there.
      const prefix =
        item.text && item.text.trim()
          ? (createTextContent(item.text).content as any[])
          : null;
      if (item.extracted?.contentHtml) {
        const doc = htmlToTiptap(item.extracted.contentHtml) as any;
        if (prefix && Array.isArray(doc?.content)) doc.content.unshift(...prefix);
        return doc;
      }
      if (item.extracted?.content) {
        const content = item.extracted.content as any;
        if (prefix && Array.isArray(content?.content)) {
          return { ...content, content: [...prefix, ...content.content] };
        }
        return content;
      }
      return createTextContent(
        [item.title, item.url, item.text].filter(Boolean).join('\n')
      );
    },
    buildTitle(item: ShareItem) {
      return item.extracted?.title || item.title || '';
    },
    buildCombinedDoc() {
      // Single source for what saveAll will persist: all items flatMapped in
      // order, title = first non-empty buildTitle. Append case returns the
      // full resulting note (existing base blocks + new blocks, existing
      // title) so the preview matches the save; missing/locked target falls
      // through to the new-note assembly exactly like saveAll (announced via
      // notice by validateTarget, never silent).
      if (!this.items.length) return { title: '', content: { type: 'doc', content: [] as any[] } };
      const blocks: any[] = [];
      for (const item of this.items) blocks.push(...docContent(this.buildContent(item)));
      if (!blocks.length) blocks.push({ type: 'paragraph' });
      const title = this.items.map((i) => this.buildTitle(i)).find((t) => t && t.trim()) || '';
      const targetId = this.items[0].targetNoteId;
      const noteStore = useNoteStore();
      const existing = targetId ? (noteStore.data as any)[targetId] : null;
      if (targetId && this.items.every((i) => i.targetNoteId === targetId) && existing && !existing.isLocked) {
        const base = docContent(existing.content);
        return { title: existing.title || title, content: { ...(existing.content || {}), type: 'doc', content: [...base, ...blocks] } };
      }
      return { title, content: { type: 'doc', content: blocks } };
    },
    async saveConfirmed() {
      await Promise.all(this.items.map((i) => this.hydrateItem(i)));
      return this.saveAll();
    },
    async saveAll() {
      const noteStore = useNoteStore();
      // ONE share action = ONE note via buildCombinedDoc; returning [note]
      // keeps the drain router (created[0].id) untouched.
      if (!this.items.length) {
        await this.closeAndClear();
        return [];
      }
      const { title, content } = this.buildCombinedDoc();
      // Append path: every item targeted the same existing note in the sheet.
      const targetId = this.items[0].targetNoteId;
      const existing = targetId ? (noteStore.data as any)[targetId] : null;
      if (targetId && this.items.every((i) => i.targetNoteId === targetId) && existing && !existing.isLocked) {
        const { writeNoteContentToYjs } = await import('@/utils/note/contentToYjs.js');
        await writeNoteContentToYjs(targetId, content);
        await noteStore.update(targetId, { content });
        await this.closeAndClear();
        return [(noteStore.data as any)[targetId]];
      }
      // Brief-vs-reality: noteStore.add(note: Partial<NoteData> & Record<string,any>)
      // understands title/content/folderId only — NoteData has no workspaceId
      // field. Notes live in the active workspace doc, so workspaceId stays
      // as sheet-selection state and is not passed per-note. The offline URL
      // is preserved inside the content body (buildContent falls back to
      // title/url/text), so no data is lost. Offline-url notes also carry
      // pendingExtraction for Task 10 retry (first offline URL wins; the rest
      // stay in the body).
      const pending = this.items.find((i) => i.offline && i.url)?.url;
      const note = await noteStore.add({
        title,
        content,
        folderId: this.folderId,
        ...(pending ? { pendingExtraction: pending } : {}),
      });
      writeLastShareFolderId(this.folderId);
      await this.closeAndClear();
      return [note];
    },
    async closeAndClear() {
      this.isOpen = false;
      this.items = [];
      this.notice = null;
      try { await invokeCommand('clear_pending_shares'); } catch {}
    },
  },
});
