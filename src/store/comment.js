import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  resolveComment,
  toggleReaction as apiToggleReaction,
} from '@/lib/api/comments';
import { useNoteSharing } from '@/composable/useNoteSharing';
import { useCollaboratorStore } from '@/store/collaborator';
import { useAccountStore } from '@/store/account';
import { importCollabKey } from '@/utils/crypto/collab';
import { displayName } from '@/utils/displayName';
import {
  encryptComment,
  decryptComment,
  packComment,
  unpackComment,
} from '@/utils/crypto/comment-crypto';

export const useCommentStore = defineStore('comment', () => {
  const comments = ref([]);
  const loading = ref(false);
  // True when the note has no shared key (personal / never-shared note), so the
  // server has no thread store for it. Surfaced inline instead of silently
  // failing to the console.
  const unavailable = ref(false);
  const activeThreadId = ref(null);
  // Hover preview (desktop fine-pointer only) — deliberately separate from
  // activeThreadId, which stays the click/selection path.
  const hoverThreadId = ref(null);
  const pendingThreadId = ref(null);
  const pendingAnchorFrom = ref(null);
  const pendingAnchorTo = ref(null);
  const showSidebar = ref(false);

  const threads = computed(() => {
    const map = {};
    for (const c of comments.value) {
      if (!map[c.threadId]) {
        map[c.threadId] = {
          id: c.threadId,
          noteId: c.noteId,
          anchorFrom: c.anchorFrom,
          anchorTo: c.anchorTo,
          resolved: !!c.resolved,
          comments: [],
        };
      }
      map[c.threadId].comments.push(c);
      if (c.resolved) map[c.threadId].resolved = true;
    }
    return Object.values(map).sort((a, b) => {
      const aTime = a.comments[0]?.createdAt || '';
      const bTime = b.comments[0]?.createdAt || '';
      return aTime.localeCompare(bTime);
    });
  });

  const unresolvedThreads = computed(() =>
    threads.value.filter((t) => !t.resolved)
  );

  const resolvedThreads = computed(() =>
    threads.value.filter((t) => t.resolved)
  );

  async function resolveNoteKey(noteId) {
    const noteKeyHex = await useNoteSharing().ensureNoteKey(noteId);
    if (!noteKeyHex) return null;
    return importCollabKey(noteKeyHex);
  }

  // Reaction rows arrive as { userId, emojisEncrypted, emojisIv }; decrypt each
  // user's emoji list into the UI shape [{ emoji, userIds }]. Bad ciphertext
  // (or a wrong AAD) is skipped, never thrown — one rotten row must not kill
  // the thread list.
  async function decryptReactionRows(key, commentId, rows) {
    const byEmoji = new Map();
    for (const row of rows) {
      if (!row?.emojisEncrypted || !row?.emojisIv || !row?.userId) continue;
      try {
        const plain = await decryptComment(
          key,
          { contentEncrypted: row.emojisEncrypted, contentIv: row.emojisIv },
          commentId,
        );
        const list = JSON.parse(plain);
        if (!Array.isArray(list)) continue;
        for (const emoji of list) {
          if (typeof emoji !== 'string') continue;
          if (!byEmoji.has(emoji)) byEmoji.set(emoji, []);
          byEmoji.get(emoji).push(row.userId);
        }
      } catch (err) {
        console.warn('[comment] Failed to decrypt reactions', commentId, err);
      }
    }
    return [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
  }

  function resolveAuthorName(authorId) {
    if (!authorId) return null;
    const profile = useAccountStore().profile;
    if (profile?.id === authorId) {
      return displayName({ id: authorId, username: profile.username });
    }
    const user = useCollaboratorStore().usernames.find((u) => u.id === authorId);
    return displayName({
      id: authorId,
      username: user?.username,
      email: user?.email,
    });
  }

  function resolveMentions(content) {
    const collaboratorStore = useCollaboratorStore();
    const mentions = [];
    const re = /@([\w.-]+)/g;
    let match;
    while ((match = re.exec(content)) !== null) {
      const user = collaboratorStore.usernames.find(
        (u) => u.username === match[1] || u.label === match[1]
      );
      if (user && !mentions.includes(user.id)) mentions.push(user.id);
    }
    return mentions;
  }

  async function fetchThreads(noteId, { baseUrl } = {}) {
    loading.value = true;
    unavailable.value = false;
    try {
      // Resolve (and bootstrap) the note key before listing: the first touch
      // self-invites the owner as a collaborator, which the list endpoint requires.
      let key = null;
      try {
        key = await resolveNoteKey(noteId);
      } catch (err) {
        console.warn('[comment] No note key for decryption:', err);
      }
      if (!key) {
        // Personal / never-shared note: no key, so no thread store. Do not fire
        // the request (it fails to the console and the empty sidebar looks like
        // comments work). Let the sidebar explain why.
        unavailable.value = true;
        comments.value = [];
        return;
      }
      // The note's own collaborator fetch runs before ensureNoteKey self-invites,
      // so it 403s and leaves the store empty; reload it now that we are in.
      await useNoteSharing().fetchCollaborators?.(noteId);
      const data = await listComments(noteId, { baseUrl });
      if (key) {
        for (const c of data) {
          if (c.contentEncrypted && c.contentIv) {
            try {
              const plain = await decryptComment(key, c, noteId);
              const { text, anchorFrom, anchorTo } = unpackComment(plain, c);
              c.content = text;
              c.anchorFrom = anchorFrom;
              c.anchorTo = anchorTo;
            } catch (err) {
              console.warn('[comment] Failed to decrypt comment', c.id, err);
            }
          }
          c.reactions = Array.isArray(c.reactions) && c.reactions.length
            ? await decryptReactionRows(key, c.id, c.reactions)
            : [];
        }
      }
      for (const c of data) {
        c.authorName = resolveAuthorName(c.authorId);
      }
      comments.value = data;
    } catch (err) {
      console.error('[comment] Failed to fetch threads:', err);
    } finally {
      loading.value = false;
    }
  }

  async function addComment(noteId, { content, threadId, anchorFrom, anchorTo, parentId, baseUrl } = {}) {
    try {
      const noteKeyHex = await useNoteSharing().ensureNoteKey(noteId);
      if (!noteKeyHex) {
        console.warn('[comment] No note key; refusing to send plaintext comment');
        throw new Error('No encryption key available for this note');
      }
      const key = await importCollabKey(noteKeyHex);
      const { contentEncrypted, contentIv } = await encryptComment(
        key,
        packComment({ text: content, anchorFrom, anchorTo }),
        noteId
      );
      const mentions = resolveMentions(content);
      const response = await createComment(
        noteId,
        { contentEncrypted, contentIv, mentions, threadId, parentId },
        { baseUrl }
      );
      const comment = response?.comment;
      if (comment) {
        comment.content = content;
        comment.anchorFrom = anchorFrom ?? null;
        comment.anchorTo = anchorTo ?? null;
        comment.authorName = resolveAuthorName(comment.authorId);
        if (!Array.isArray(comment.reactions)) comment.reactions = [];
        comments.value.push(comment);
      }
      pendingThreadId.value = null;
      pendingAnchorFrom.value = null;
      pendingAnchorTo.value = null;
      return comment;
    } catch (err) {
      console.error('[comment] Failed to add comment:', err);
      throw err;
    }
  }

  async function editComment(commentId, content, { baseUrl } = {}) {
    try {
      const existing = comments.value.find((x) => x.id === commentId);
      const noteId = existing?.noteId;
      const noteKeyHex = await useNoteSharing().ensureNoteKey(noteId);
      if (!noteKeyHex) {
        console.warn('[comment] No note key; refusing to send plaintext edit');
        throw new Error('No encryption key available for this note');
      }
      const key = await importCollabKey(noteKeyHex);
      const { contentEncrypted, contentIv } = await encryptComment(
        key,
        packComment({
          text: content,
          anchorFrom: existing?.anchorFrom,
          anchorTo: existing?.anchorTo,
        }),
        noteId
      );
      await updateComment(commentId, { contentEncrypted, contentIv }, { baseUrl });
      const c = comments.value.find((x) => x.id === commentId);
      if (c) c.content = content;
    } catch (err) {
      console.error('[comment] Failed to edit comment:', err);
      throw err;
    }
  }

  async function removeComment(commentId, { baseUrl } = {}) {
    try {
      await deleteComment(commentId, { baseUrl });
      comments.value = comments.value.filter(
        (c) => c.id !== commentId && c.parentId !== commentId
      );
    } catch (err) {
      console.error('[comment] Failed to remove comment:', err);
      throw err;
    }
  }

  async function toggleResolve(threadId, { baseUrl } = {}) {
    try {
      const thread = threads.value.find((t) => t.id === threadId);
      if (!thread || !thread.comments.length) return;
      const rootComment = thread.comments[0];
      const result = await resolveComment(rootComment.id, { baseUrl });
      const newResolved = result?.resolved;
      for (const c of comments.value) {
        if (c.threadId === threadId) {
          c.resolved = newResolved ? 1 : 0;
        }
      }
    } catch (err) {
      console.error('[comment] Failed to toggle resolve:', err);
      throw err;
    }
  }

  function setActiveThread(threadId) {
    activeThreadId.value = threadId;
    if (threadId) showSidebar.value = true;
  }

  function setHoverThread(threadId) {
    hoverThreadId.value = threadId;
  }

  // Optimistic local toggle; the wire format is the caller's whole emoji list
  // encrypted with the note key (per-user row, server never sees emoji).
  // Restore the snapshot on any failure.
  async function toggleReaction(commentId, emoji, { baseUrl } = {}) {
    const c = comments.value.find((x) => x.id === commentId);
    if (!c) return;
    const myId = useAccountStore().profile?.id;
    if (!myId) return;
    if (!Array.isArray(c.reactions)) c.reactions = [];
    const snapshot = c.reactions.map((r) => ({ emoji: r.emoji, userIds: [...r.userIds] }));
    const bucket = c.reactions.find((r) => r.emoji === emoji);
    const wasIn = !!bucket && bucket.userIds.includes(myId);

    // My current list, then toggle.
    const myEmojis = c.reactions
      .filter((r) => r.userIds.includes(myId))
      .map((r) => r.emoji);
    const nextEmojis = wasIn
      ? myEmojis.filter((e) => e !== emoji)
      : [...myEmojis, emoji];

    // Optimistic UI update.
    if (!bucket) c.reactions.push({ emoji, userIds: [] });
    const target = c.reactions.find((r) => r.emoji === emoji);
    const idx = target.userIds.indexOf(myId);
    if (idx >= 0) target.userIds.splice(idx, 1);
    else target.userIds.push(myId);
    c.reactions = c.reactions.filter((r) => r.userIds.length > 0);

    try {
      const key = await resolveNoteKey(c.noteId);
      if (!key) throw new Error('No encryption key available for this note');
      const { contentEncrypted, contentIv } = await encryptComment(
        key,
        JSON.stringify(nextEmojis),
        commentId,
      );
      const result = await apiToggleReaction(
        commentId,
        { emojisEncrypted: contentEncrypted, emojisIv: contentIv },
        { baseUrl },
      );
      if (Array.isArray(result?.reactions)) {
        c.reactions = await decryptReactionRows(key, commentId, result.reactions);
      }
    } catch (err) {
      console.error('[comment] Failed to toggle reaction:', err);
      c.reactions = snapshot;
      throw err;
    }
  }

  function setPendingThread(threadId, anchorFrom, anchorTo) {
    pendingThreadId.value = threadId;
    pendingAnchorFrom.value = anchorFrom ?? null;
    pendingAnchorTo.value = anchorTo ?? null;
    activeThreadId.value = threadId;
    showSidebar.value = true;
  }

  function openSidebar() {
    showSidebar.value = true;
  }

  function closeSidebar() {
    showSidebar.value = false;
    activeThreadId.value = null;
  }

  function reset() {
    comments.value = [];
    unavailable.value = false;
    activeThreadId.value = null;
    hoverThreadId.value = null;
    pendingThreadId.value = null;
    pendingAnchorFrom.value = null;
    pendingAnchorTo.value = null;
    showSidebar.value = false;
  }

  return {
    comments,
    loading,
    unavailable,
    activeThreadId,
    hoverThreadId,
    pendingThreadId,
    pendingAnchorFrom,
    pendingAnchorTo,
    showSidebar,
    threads,
    unresolvedThreads,
    resolvedThreads,
    fetchThreads,
    addComment,
    editComment,
    removeComment,
    toggleResolve,
    setActiveThread,
    setHoverThread,
    toggleReaction,
    setPendingThread,
    openSidebar,
    closeSidebar,
    reset,
  };
});
