import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  resolveComment,
} from '@/lib/api/comments';

export const useCommentStore = defineStore('comment', () => {
  const comments = ref([]);
  const loading = ref(false);
  const activeThreadId = ref(null);
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

  async function fetchThreads(noteId, { baseUrl } = {}) {
    loading.value = true;
    try {
      const data = await listComments(noteId, { baseUrl });
      comments.value = data;
    } catch (err) {
      console.error('[comment] Failed to fetch threads:', err);
    } finally {
      loading.value = false;
    }
  }

  async function addComment(noteId, { content, threadId, anchorFrom, anchorTo, parentId, baseUrl } = {}) {
    try {
      const response = await createComment(
        noteId,
        { content, threadId, anchorFrom, anchorTo, parentId },
        { baseUrl }
      );
      const comment = response?.comment;
      if (comment) {
        comments.value.push(comment);
      }
      return comment;
    } catch (err) {
      console.error('[comment] Failed to add comment:', err);
      throw err;
    }
  }

  async function editComment(commentId, content, { baseUrl } = {}) {
    try {
      await updateComment(commentId, { content }, { baseUrl });
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
    activeThreadId.value = null;
    pendingThreadId.value = null;
    pendingAnchorFrom.value = null;
    pendingAnchorTo.value = null;
    showSidebar.value = false;
  }

  return {
    comments,
    loading,
    activeThreadId,
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
    setPendingThread,
    openSidebar,
    closeSidebar,
    reset,
  };
});
