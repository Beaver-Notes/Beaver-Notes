<template>
  <div v-if="note" class="flex flex-col">
    <template v-if="editor && !isLocked">
      <div
        class="no-print sticky top-4 mobile:top-0 z-10 flex items-start px-4"
      >
        <div
          v-if="previousNote && !uiState.inReaderMode"
          class="bg-white dark:bg-neutral-900 border p-1 rounded-xl shadow-sm flex items-center w-fit max-w-content"
        >
          <button
            class="hoverable h-8 px-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300 mobile:hidden"
            :title="translations.editor.backShortcutTitle || 'Alt+Arrow left'"
            @click="goToPrevious"
          >
            <v-remixicon name="riArrowLeftLine" class="flex-shrink-0" />
            <span class="truncate max-w-[16rem]">
              {{
                previousNote.title ||
                translations.editor.untitledNote ||
                'Untitled'
              }}
            </span>
          </button>
        </div>
        <div class="flex-1"></div>
        <note-actions
          v-bind="{
            editor,
            id,
            note,
            showSearch,
            goBack,
            peers: presence.peers,
            localColor: presence.localColor?.value,
            localName: accountStore.profile?.username || 'Anonymous',
            showHistory,
            showComments,
            isShared,
          }"
          @toggle-search="showSearch = !showSearch"
          @toggle-history="showHistory = !showHistory"
          @toggle-comments="toggleComments"
        />
      </div>
    </template>

    <div
      class="editor note-editor-page self-center w-full px-4 pt-10"
      :class="{ 'mobile-search-open': showSearch, 'mobile:pt-0': !uiState.inReaderMode, 'mobile:pt-6': uiState.inReaderMode }"
      :data-reader-theme="uiState.inReaderMode ? prefs.theme : null"
      :data-reader-family="prefs.family"
      :data-full-width="note?.isFullWidth ? 'true' : null"
      :style="
        uiState.inReaderMode
          ? {
              '--selected-width': '42rem',
              'padding-bottom': isLocked ? 0 : 'var(--app-note-page-padding)',
              '--reader-size': prefs.size + 'px',
              '--reader-line': prefs.line,
            }
          : {
              '--selected-width': note?.isFullWidth ? '100%' : '54rem',
              'padding-bottom': isLocked ? 0 : 'var(--app-note-page-padding)',
            }
      "
      @mousedown.self="uiState.inReaderMode && exitReader()"
    >
      <template v-if="editor && !isLocked">
        <div :style="{ paddingInlineStart: 'var(--drag-handle-gutter, 0px)', paddingInlineEnd: note?.isFullWidth ? 'var(--drag-handle-gutter, 0px)' : undefined }">
          <transition
            v-if="showSearch"
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 translate-y-4"
            enter-to-class="opacity-0 translate-y-0"
            leave-active-class="transition duration-150 ease-out"
            leave-from-class="opacity-0 translate-y-0"
            leave-to-class="opacity-0 translate-y-4"
          >
            <note-search
              v-bind="{ editor }"
              @close="closeSearch"
              @keyup.esc="closeSearch"
            />
          </transition>
          <note-toolbar v-else v-bind="{ editor, id, note, showSearch }" />
        </div>
      </template>
      <div
        v-if="pendingSetup"
        class="flex items-center gap-2 mb-4 text-sm text-neutral-500 dark:text-neutral-400"
      >
        <span>{{
          translations.note?.settingUpOnDevice || 'Setting up on this device…'
        }}</span>
      </div>
      <div
        v-if="yjsError"
        class="flex flex-col items-center gap-3 mb-4 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
      >
        <span>{{ yjsError }}</span>
        <button
          class="px-3 py-1 rounded bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700 transition"
          @click="
            yjsError = null;
            yjsLoad(id, note?.content, note?.title || '').catch((e) => {
              yjsError = e?.message || 'Retry failed';
            });
          "
        >
          {{ translations.common?.retry || 'Retry' }}
        </button>
      </div>
      <div
        v-if="!isLocked"
        class="editor prose dark:prose-invert max-w-none w-full mb-12 mobile:mb-6"
      >
        <h1
          ref="titleDiv"
          data-testid="note-title-input"
          :contenteditable="canEdit(noteRole) && !uiState.inReaderMode"
          class="outline-none bg-transparent cursor-text title-placeholder"
          :class="editor ? '' : 'invisible'"
          :data-placeholder="translations.editor.untitledNote"
          :style="{ paddingInlineStart: 'var(--drag-handle-gutter, 0px)', paddingInlineEnd: note?.isFullWidth ? 'var(--drag-handle-gutter, 0px)' : undefined }"
          @input="handleTitleInput"
          @keydown="disallowedEnter"
        ></h1>
      </div>
      <div
        v-else
        class="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] py-12 w-full"
      >
        <unlock-card
          :title="
            translations.settings?.unlockAppEncryptionTitle ||
            'Unlock to continue'
          "
          :body="
            appEncryptedLocked
              ? translations.settings?.unlockAppEncryptionBody ||
                'Your notes are encrypted. Enter your encryption passphrase to unlock the app.'
              : translations.card.unlockToEdit ||
                'This note is locked. Enter your vault password or use biometrics to unlock it.'
          "
          :hint="'Encryption is always active: your notes and assets are protected at rest.'"
          :password="lockedPassword"
          :placeholder="translations.settings?.password || 'Vault password'"
          :error="lockedError"
          :busy="lockedBusy"
          :biometric-busy="lockedBiometricBusy"
          :biometric-available="lockedBiometricAvailable"
          :biometric-label="
            translations.settings?.unlockWithBiometrics ||
            'Unlock with Touch ID'
          "
          :unlock-label="translations.settings?.unlock || 'Unlock'"
          :require-password="true"
          show-close
          :close-label="translations.index.close || 'Close'"
          @update:password="lockedPassword = $event"
          @unlock="
            appEncryptedLocked
              ? handleEncryptedPasswordUnlock()
              : handleIsLockedPasswordUnlock()
          "
          @unlock-biometrics="
            appEncryptedLocked
              ? handleEncryptedBiometricUnlock()
              : handleIsLockedUnlock()
          "
        />
      </div>

      <div v-if="!isLocked" class="relative editor-skeleton-wrapper">
        <note-editor
          v-if="yjsReady"
          :id="$route.params.id"
          ref="noteEditor"
          :key="`${$route.params.id}-${awareness?.clientID ?? 'no-aw'}`"
          :ydoc="ydoc"
          :awareness="awareness"
          :user-name="accountStore.profile?.username || 'Anonymous'"
          :note="note"
          :role="noteRole"
          :cursor-position="note.lastCursorPosition"
          @update="
            autoScroll();
            handleContentUpdate($event);
          "
          @init="editor = $event"
          @keyup.down="autoScroll"
          @comment-activated="onCommentActivated"
        />
        <div v-if="yjsReady && !editor" class="editor-skeleton">
          <div class="space-y-4 animate-pulse">
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-3/4" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-1/2" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-5/6" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-2/3" />
          </div>
        </div>
        <div v-if="!yjsReady" class="editor-skeleton">
          <div class="space-y-4 animate-pulse">
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-3/4" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-1/2" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-5/6" />
            <div class="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-2/3" />
          </div>
        </div>
      </div>
      <note-backlinks v-if="!isLocked" />
    </div>
    <ReaderPill
      v-if="uiState.inReaderMode"
      @exit="exitReader"
      @change="() => {}"
    />

    <note-headings-progress
      v-if="editor"
      :editor="editor"
      class="mobile:hidden ipad:hidden"
    />
    <word-count-pill
      v-if="editor && !isLocked && note.showWordCount"
      :editor="editor"
      :note="note"
      class="mobile:hidden ipad:hidden"
    />
    <div
      v-if="showComments && isDocked"
      class="hidden xl:flex justify-center px-4 pb-10"
    >
      <div class="w-full flex justify-center">
        <comment-sidebar :note-id="id" :docked="true" @close="closeComments" />
      </div>
    </div>
    <template v-if="showComments && !isDocked">
      <div
        class="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]"
        @click="closeComments"
      />
      <comment-sidebar :note-id="id" :docked="false" @close="closeComments" />
    </template>
  </div>
</template>

<script>
import {
  ref,
  shallowRef,
  computed,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
} from 'vue';
import { debounce } from '@/utils/helpers/index.js';
import { useRouter, onBeforeRouteLeave, useRoute } from 'vue-router';
import { useNoteStore } from '@/store/note';
import { useLabelStore } from '@/store/label';
import { useUiState } from '@/composable/useUiState';
import { useSidebar } from '@/composable/useSidebar';
import { useStore } from '@/store';
import { addCloseHandler, path } from '@/lib/tauri-bridge';
import { useNotePersistence } from '@/utils/note/persistence';
import { useNoteEncryption } from '@/utils/crypto/note-encryption';
import { useAudioRecorder } from '@/composable/useAudioRecorder';
import { insertAudioIntoClosedNote } from '@/utils/assets/audioInsert';
import NoteToolbar from '@/components/note/NoteToolbar.vue';
import NoteEditor from '@/components/note/NoteEditor.vue';
import NoteActions from '@/components/note/NoteActions.vue';
import NoteSearch from '@/components/note/NoteSearch.vue';
import NoteHeadingsProgress from '@/components/note/NoteHeadingsProgress.vue';
import WordCountPill from '@/components/note/WordCountPill.vue';
import NoteBacklinks from '@/components/note/NoteBacklinks.vue';
import { useAppStore } from '../../store/app';
import { useAccountStore } from '@/store/account';
import {
  isEncryptedContent,
  verifyPassphrase,
  tryRestoreKeyFromSafeStorage,
} from '@/utils/crypto/encryption.js';
import { decryptNoteForMemory, hydrateNote } from '@/utils/note/serializer.js';
import {
  isBiometricAvailable,
  authenticateWithBiometrics,
} from '@/lib/native/biometric.js';
import { buildMenuContext, pushMenuContext } from '@/utils/ui/menuContext';
import { bindGlobalShortcuts } from '@/utils/ui/globalShortcuts.js';
import { useTranslations } from '@/composable/useTranslations';
import { useNoteYjs } from '@/composable/useNoteYjs';
import { useNoteHistory } from '@/composable/useNoteHistory';
import { useNoteSharing } from '@/composable/useNoteSharing';
import { getWsSync } from '@/lib/sync/ws-sync';
import { Awareness } from 'y-protocols/awareness';
import { usePresence } from '@/composable/usePresence';
import { useCommentStore } from '@/store/comment';
import CommentSidebar from '@/components/note/CommentSidebar.vue';
import UnlockCard from '@/components/app/UnlockCard.vue';
import { canEdit } from '@/utils/permissions';
import { displayName } from '@/utils/displayName';
import ReaderPill from '@/components/note/ReaderPill.vue';
import { useReaderPrefs } from '@/composable/useReaderPrefs';

export default {
  components: {
    NoteEditor,
    NoteActions,
    NoteSearch,
    NoteToolbar,
    NoteHeadingsProgress,
    WordCountPill,
    NoteBacklinks,
    CommentSidebar,
    UnlockCard,
    ReaderPill,
  },
  inheritAttrs: false,
  setup() {
    const uiState = useUiState();
    const { prefs } = useReaderPrefs();
    const { expanded: sidebarExpanded } = useSidebar();
    const route = useRoute();
    const store = useStore();
    const router = useRouter();
    const noteStore = useNoteStore();
    const labelStore = useLabelStore();
    const appStore = useAppStore();

    const editor = shallowRef(null);
    function exitReader() {
      uiState.inReaderMode = false;
      try {
        if (document.fullscreenElement) document.exitFullscreen();
      } catch {}
      editor.value?.setOptions?.({ editable: true });
      document.documentElement.removeAttribute('data-reader-theme-legacy');
    }
    const noteEditor = ref();
    const showSearch = shallowRef(false);
    const showHistory = ref(false);
    const showComments = ref(false);
    const commentStore = useCommentStore();
    const isLargeScreen = ref(
      typeof window !== 'undefined' ? window.innerWidth >= 1280 : false,
    );
    const isDocked = computed(() => showComments.value && isLargeScreen.value);
    function onResize() {
      isLargeScreen.value = window.innerWidth >= 1280;
    }
    onMounted(() => window.addEventListener('resize', onResize));
    onUnmounted(() => window.removeEventListener('resize', onResize));
    const titleDiv = ref(null);
    const noteHistory = useNoteHistory();
    const sharing = useNoteSharing();

    const id = computed(() => route.params.id);
    const note = computed(() => noteStore.getById(id.value));
    const appEncryptedLocked = computed(
      () => !!note.value && isEncryptedContent(note.value.content),
    );
    const isLocked = computed(
      () => !!note.value && (note.value.isLocked || appEncryptedLocked.value),
    );
    const { translations } = useTranslations();

    const recorder = useAudioRecorder();

    function handleRecordingStopped(payload) {
      const { filePath, noteId, cursorPos } = payload;
      if (noteId !== id.value) return;
      payload.markConsumed();
      if (note.value && editor.value) {
        const filename = path.basename(filePath);
        const src = `assets://${noteId}/${filename}`;
        const pos = cursorPos ?? editor.value.state.selection.from;
        editor.value.commands.setTextSelection(pos);
        editor.value.commands.setAudio(src, filename);
      } else {
        void insertAudioIntoClosedNote(
          noteId,
          filePath,
          noteStore,
          cursorPos,
        ).catch((error) => {
          console.error('Failed to insert recording into note:', error);
        });
      }
    }
    const stopRecorderListener = recorder.onStopped(handleRecordingStopped);

    recorder.openNoteId.value = id.value;

    const pushNoteMenuContext = () => {
      pushMenuContext(
        buildMenuContext({
          routeName: 'Note',
          noteEditable: !isLocked.value,
          noteLocked: isLocked.value,
          inReaderMode: uiState.inReaderMode,
        }),
      );
    };

    watch(
      () => [id.value, isLocked.value, uiState.inReaderMode],
      () => pushNoteMenuContext(),
      { immediate: true },
    );

    const accountStore = useAccountStore();
    const wsSync = getWsSync();
    const noteRole = ref(wsSync.getRoomRole(id.value));
    watch(
      () => sharing.collaborators.value,
      (list) => {
        if (!list?.length || !accountStore.profile?.id) return;
        const self = list.find(
          (c) =>
            c.userId === accountStore.profile.id ||
            c.username === accountStore.profile.username,
        );
        if (self?.role) noteRole.value = self.role;
      },
      { immediate: true },
    );

    const {
      doc: ydoc,
      ready: yjsReady,
      pendingSetup,
      load: yjsLoad,
      getTitle: yjsGetTitle,
      setTitle: yjsSetTitle,
      observeTitle: yjsObserveTitle,
    } = useNoteYjs();

    // Show "syncing" state when yjs is ready but the doc has no content yet
    // (content arrives via sync after metadata). Prevents blank editor flash.
    const yjsError = ref(null);

    const awareness = shallowRef(null);

    function displayNameForPresence() {
      const p = accountStore.profile;
      const name = displayName(p);
      return name === 'Unknown' ? 'Anonymous' : name;
    }
    const presence = usePresence(
      awareness,
      accountStore.profile?.id || 'anonymous',
      displayNameForPresence(),
    );

    // Create/destroy Awareness only after ydoc resolves; never cache across doc switches
    watch(
      ydoc,
      (doc, oldDoc) => {
        // teardown previous
        if (awareness.value) {
          try {
            awareness.value.setLocalState(null);
          } catch {}
          presence.destroy();
          awareness.value = null;
        }
        if (!doc) return;
        const aw = new Awareness(doc);
        awareness.value = aw;
        // set initial local user state (usePresence.init does this, but ensure)
        presence.init();
        // pass this awareness to ws-sync so provider reuses same instance (per-doc guard)
        // joinNoteRoom is idempotent; if provider already exists for this doc it is skipped
        if (id.value) {
          const wsSyncAny = getWsSync();
          // if provider for this note already created without external awareness, we need to re-wire:
          // leave and re-join with correct awareness
          // detection: provider exists but its awareness !== aw
          wsSyncAny.joinNoteRoom?.(id.value, doc, aw);
        }
      },
      { immediate: true },
    );

    watch(
      () => accountStore.profile?.username || accountStore.profile?.email,
      (name) => {
        if (awareness.value) {
          const display = displayNameForPresence();
          presence.setLocalState({ name: display });
        }
      },
    );

    onUnmounted(() => {
      presence.destroy();
      if (awareness.value) {
        try {
          awareness.value.setLocalState(null);
        } catch {}
        awareness.value = null;
      }
    });

    const isShared = computed(() => sharing.collaborators.value.length > 0);
    watch(
      id,
      async (newId) => {
        if (newId && accountStore.isAuthenticated) {
          try {
            await sharing.fetchCollaborators(newId);
          } catch {
            // Errors handled internally by useNoteSharing
          }
        }
      },
      { immediate: true },
    );

    function toggleComments() {
      showComments.value = !showComments.value;
      if (showComments.value && isShared.value) {
        commentStore.fetchThreads(id.value, {
          baseUrl: accountStore.serverUrl,
        });
      }
    }
    function closeComments() {
      showComments.value = false;
      commentStore.closeSidebar();
    }
    watch(
      () => [isShared.value, id.value],
      async ([shared, noteId]) => {
        if (shared && noteId && accountStore.isAuthenticated) {
          commentStore.fetchThreads(noteId, {
            baseUrl: accountStore.serverUrl,
          });
        }
      },
      { immediate: true },
    );
    onUnmounted(() => {
      commentStore.reset();
    });
    function onCommentActivated(commentId) {
      if (!commentId) return;
      commentStore.setActiveThread(commentId);
      showComments.value = true;
    }
    watch(
      () => commentStore.showSidebar,
      (open) => {
        if (open) showComments.value = true;
      },
    );

    const { updateNote, persistCurrentNote, flushScheduledPersist } =
      useNotePersistence({
        noteStore,
        labelStore,
        appEncryptedLocked,
      });

    const showBack = computed(() => {
      const back = router.options.history.state.back;
      if (!back) return false;
      if (back === '/' || back.includes('/#/?')) return false;
      return true;
    });
    const previousNote = computed(() => {
      const fromId = route.query.from;
      if (!fromId) return null;
      return noteStore.getById(fromId) || null;
    });
    function goBack() {
      const from = router.options.history.state.back;
      if (!from) {
        router.push('/');
        return;
      }
      if (from.includes('/folder/') || from.includes('/archive/')) {
        router.go(-1);
        return;
      }
      if (from.includes('/note/')) {
        router.go(-1);
        return;
      }
      router.push('/');
    }
    function goToPrevious() {
      if (previousNote.value) {
        router.push({
          name: 'Note',
          params: { id: previousNote.value.id },
        });
        return;
      }
      goBack();
    }

    const { unlockAppEncryption } = useNoteEncryption({
      noteId: id,
    });

    // locked-note inline unlock state (encrypted + isLocked)
    const lockedPassword = ref('');
    const lockedError = ref('');
    const lockedBusy = ref(false);
    const lockedBiometricBusy = ref(false);
    const lockedBiometricAvailable = ref(false);
    onMounted(async () => {
      try {
        lockedBiometricAvailable.value = await isBiometricAvailable();
      } catch {
        lockedBiometricAvailable.value = false;
      }
    });
    watch(isLocked, (locked) => {
      if (!locked) {
        lockedError.value = '';
        lockedPassword.value = '';
      }
    });

    async function handleIsLockedUnlock() {
      lockedError.value = '';
      if (lockedBiometricAvailable.value) {
        lockedBusy.value = true;
        try {
          await authenticateWithBiometrics('Unlock note');
        } catch (e) {
          const msg = String(e?.message || '');
          if (/cancel/i.test(msg) || /User canceled/i.test(msg)) {
            lockedBusy.value = false;
            return;
          }
          lockedError.value = msg || 'Authentication failed.';
          lockedBusy.value = false;
          return;
        }
        lockedBusy.value = false;
      }
      try {
        await noteStore.unlockNote(note.value.id);
      } catch (e) {
        lockedError.value = e?.message || 'Failed to unlock.';
      }
    }
    async function handleIsLockedPasswordUnlock() {
      if (!lockedPassword.value?.trim() || lockedBusy.value) return;
      lockedBusy.value = true;
      lockedError.value = '';
      try {
        const res = await verifyPassphrase(lockedPassword.value);
        if (!res.ok) {
          lockedError.value = res.error || 'Wrong vault password.';
          return;
        }
        lockedPassword.value = '';
        await noteStore.unlockNote(note.value.id);
      } catch (e) {
        lockedError.value = e?.message || 'Wrong vault password.';
      } finally {
        lockedBusy.value = false;
      }
    }
    async function handleEncryptedPasswordUnlock() {
      if (!lockedPassword.value?.trim() || lockedBusy.value) return;
      lockedBusy.value = true;
      lockedError.value = '';
      try {
        const res = await verifyPassphrase(lockedPassword.value);
        if (!res.ok) {
          lockedError.value = res.error || 'Wrong passphrase.';
          return;
        }
        lockedPassword.value = '';
        const current = noteStore.getById(id.value);
        if (current && isEncryptedContent(current.content)) {
          const decrypted = await decryptNoteForMemory(current);
          if (decrypted !== current)
            noteStore.data[id.value] = hydrateNote(decrypted);
        }
      } catch (e) {
        lockedError.value = e?.message || 'Wrong passphrase.';
      } finally {
        lockedBusy.value = false;
      }
    }
    async function handleEncryptedBiometricUnlock() {
      lockedBiometricBusy.value = true;
      lockedError.value = '';
      try {
        await authenticateWithBiometrics('Unlock note');
        const ok = await tryRestoreKeyFromSafeStorage();
        if (!ok) {
          lockedError.value = 'Failed to retrieve stored passphrase.';
          return;
        }
        const current = noteStore.getById(id.value);
        if (current && isEncryptedContent(current.content)) {
          const decrypted = await decryptNoteForMemory(current);
          if (decrypted !== current)
            noteStore.data[id.value] = hydrateNote(decrypted);
        }
      } catch (e) {
        const msg = String(e?.message || '');
        if (/cancel/i.test(msg) || /User canceled/i.test(msg)) return;
        lockedError.value = msg || 'Biometric authentication failed.';
      } finally {
        lockedBiometricBusy.value = false;
      }
    }

    const autoScroll = debounce(() => {
      if (!noteEditor.value) return;
      const lastChild =
        noteEditor.value.$el.querySelector('.ProseMirror')?.lastChild;
      if (!lastChild) return;
      if (
        !(
          document.body.scrollHeight >
          (window.innerHeight || document.documentElement.clientHeight)
        )
      )
        return;
      const selection = window.getSelection();
      if (!lastChild.contains(selection.anchorNode)) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const lastRect = lastChild.getBoundingClientRect();
      const lineHeight = rect.height;
      const offset = Math.abs(rect.bottom - lastRect.bottom);
      if (lastRect.top + lastRect.height <= window.innerHeight) return;
      if (lineHeight === 0) lastChild.scrollIntoView();
      else if (offset < lineHeight) lastChild.scrollIntoView();
    }, 50);

    watch(
      id,
      async (n) => {
        const currentNote = noteStore.getById(n);
        if (currentNote && isEncryptedContent(currentNote.content)) {
          const decrypted = await decryptNoteForMemory(currentNote);
          if (decrypted !== currentNote) {
            noteStore.data[n] = hydrateNote(decrypted);
          }
        }
        if (!appStore.setting.collapsibleHeading && !isLocked.value) {
          noteStore.convertNote(n);
        }
      },
      { immediate: true },
    );

    let titleInitialized = false;

    const handleTitleInput = debounce((event) => {
      if (!titleInitialized) return;
      const text = event.target.textContent || '';
      yjsSetTitle(text);
      autoResizeTitle();
      // Update the store title immediately: relying on the Yjs observer alone
      // let the workspace-doc round-trip reset the contenteditable mid-typing
      // (caret jump).
      return updateNote(id.value, { title: text });
    }, 150);

    let isComposing = false;
    function onCompositionStart() {
      isComposing = true;
    }
    function onCompositionEnd(e) {
      isComposing = false;
      handleTitleInput(e);
    }
    watch(
      titleDiv,
      (el, oldEl) => {
        oldEl?.removeEventListener('compositionstart', onCompositionStart);
        oldEl?.removeEventListener('compositionend', onCompositionEnd);
        el?.addEventListener('compositionstart', onCompositionStart);
        el?.addEventListener('compositionend', onCompositionEnd);
      },
      { immediate: true },
    );

    function handleContentUpdate(content) {
      if (ydoc.value) return; // Yjs manages content persistence
      return updateNote(id.value, { content });
    }

    function closeSearch() {
      showSearch.value = false;
    }

    // Route watcher for persist-on-leave
    watch(
      () => route.params.id,
      (noteId, oldNoteId) => {
        if (oldNoteId && noteId && noteStore.getById(oldNoteId)) {
          noteStore.patchLocal(oldNoteId, {
            lastCursorPosition: editor.value?.state.selection.to,
          });
          void flushScheduledPersist(oldNoteId).catch((error) => {
            console.error('Error persisting previous note:', error);
          });
        }

        if (!noteId) return;

        // Check the Pinia note store (source of truth) instead of the legacy
        // KV table which post-migration / synced notes never write to.
        const currentNote = noteStore.getById(noteId);
        if (!currentNote || !currentNote.id) {
          router.push('/');
        } else {
          store.activeNoteId = currentNote.id;
          localStorage.setItem('lastNoteEdit', noteId);
        }

        // Read content at call time: decrypt watcher may have updated store since fire.
        const currentForLoad = noteStore.getById(noteId);
        const seedContent = currentForLoad?.content;
        const seedTitle = currentForLoad?.title || '';
        yjsError.value = null;
        yjsLoad(noteId, seedContent, seedTitle).catch((err) => {
          console.error('[yjs] Failed to load note:', err);
          yjsError.value = err?.message || 'Failed to load note';
        });
      },
      { immediate: true },
    );

    const handleBeforeUnload = () => {
      void persistCurrentNote(editor.value, titleDiv.value, route.params.id);
    };
    let removeGlobalShortcuts = () => {};

    const scrollTitleIntoView = () => {
      const titleEl = titleDiv.value;
      if (!titleEl) return;
      const rect = titleEl.getBoundingClientRect();
      const stickyHeight = 56;
      if (rect.top < stickyHeight) {
        window.scrollTo({
          top: Math.max(0, window.scrollY + rect.top - stickyHeight),
          behavior: 'instant',
        });
      }
    };

    let removeEditorListeners = () => {};

    watch(editor, (ed) => {
      if (!ed) return;
      const dom = ed.view.dom;
      let isFirstFocus = true;

      const onFocus = () => {
        pushNoteMenuContext();
        if (window.innerWidth >= 768) return;
        if (!isFirstFocus) return;
        isFirstFocus = false;
        setTimeout(scrollTitleIntoView, 350);
      };

      dom.addEventListener('focusin', onFocus);
      removeEditorListeners = () => dom.removeEventListener('focusin', onFocus);
    });

    onMounted(() => {
      removeGlobalShortcuts = bindGlobalShortcuts({
        'mod+f': () => {
          showSearch.value = true;
        },
        'alt+left': () => {
          if (!route.query.linked) return false;
          router.back();
        },
      });
      window.addEventListener('beforeunload', handleBeforeUnload);

      if (titleDiv.value) {
        const titleText = note.value?.title || yjsGetTitle() || '';
        if (titleText) {
          titleDiv.value.textContent = titleText;
          autoResizeTitle();
        }
        titleInitialized = true;
      }
    });

    onUnmounted(() => {
      stopTitleObserver();
      stopRecorderListener();
      if (recorder.openNoteId.value === id.value)
        recorder.openNoteId.value = null;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      removeGlobalShortcuts();
      removeEditorListeners();
    });

    onBeforeRouteLeave((to) => {
      // Leave the native menu on a neutral screen while the next route is
      // being resolved; the app-shell watcher repaints it on arrival.
      pushMenuContext(buildMenuContext({ routeName: to.name }));
      void persistCurrentNote(editor.value, titleDiv.value, route.params.id, {
        wait: false,
      });
      removeGlobalShortcuts();
    });

    addCloseHandler(async () => {
      await persistCurrentNote(editor.value, titleDiv.value, route.params.id);
    });

    const focusEditor = () => {
      if (editor.value?.commands?.focus) {
        editor.value.commands.focus(undefined, { scrollIntoView: false });
        return;
      }

      const focusTarget =
        noteEditor.value?.$el?.querySelector('*[tabindex="0"]');

      if (!focusTarget?.focus) return;

      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    };

    const disallowedEnter = (event) => {
      if (event && event.key === 'Enter') {
        focusEditor();
        event.returnValue = false;
      }
    };

    function autoResizeTitle() {
      const el = titleDiv.value;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    watch(
      () => uiState.showPrompt.value,
      (n) => {
        if (!n) {
          focusEditor();
        }
      },
    );

    function isTitleFocused(titleEl) {
      if (!titleEl) return false;
      return document.activeElement === titleEl;
    }

    watch(
      () => note.value,
      async (newNote) => {
        await nextTick();
        if (!titleDiv.value) return;
        if (isTitleFocused(titleDiv.value) || isComposing) {
          titleInitialized = true;
          autoResizeTitle();
          return;
        }
        const stored = newNote?.title || yjsGetTitle() || '';
        if (titleDiv.value.textContent !== stored) {
          titleDiv.value.textContent = stored;
        }
        autoResizeTitle();
        titleInitialized = true;
      },
      { immediate: true },
    );

    // Sync remote Yjs title changes back to the store and to the div
    let stopTitleObserver = () => {};
    watch(
      ydoc,
      (newDoc, oldDoc) => {
        stopTitleObserver();
        if (!newDoc) return;
        stopTitleObserver = yjsObserveTitle((title) => {
          if (
            note.value &&
            note.value.title !== title &&
            !(note.value.title && title === '')
          ) {
            updateNote(id.value, { title });
          }
          if (isTitleFocused(titleDiv.value) || isComposing) return;
          if (titleDiv.value && titleDiv.value.textContent !== title) {
            titleDiv.value.textContent = title;
            autoResizeTitle();
          }
        });
      },
      { immediate: true },
    );

    return {
      id,
      showBack,
      previousNote,
      titleDiv,
      goBack,
      goToPrevious,
      noteEditor,
      note,
      translations,
      uiState,
      sidebarExpanded,
      unlockAppEncryption,
      appEncryptedLocked,
      lockedPassword,
      lockedError,
      lockedBusy,
      lockedBiometricBusy,
      lockedBiometricAvailable,
      handleIsLockedUnlock,
      handleIsLockedPasswordUnlock,
      handleEncryptedPasswordUnlock,
      handleEncryptedBiometricUnlock,
      editor,
      showSearch,
      showHistory,
      handleTitleInput,
      handleContentUpdate,
      closeSearch,
      disallowedEnter,
      autoResizeTitle,
      autoScroll,
      isLocked,
      yjsReady,
      ydoc,
      pendingSetup,
      awareness,
      presence,
      isShared,
      accountStore,
      showComments,
      isDocked,
      isLargeScreen,
      toggleComments,
      commentStore,
      onCommentActivated,
      noteRole,
      canEdit,
      yjsError,
      prefs,
      exitReader,
    };
  },
};
</script>

<style scoped>
.title-placeholder:empty::before {
  content: attr(data-placeholder);
  color: var(--text-muted);
}

.title-placeholder {
  field-sizing: content;
  max-height: 8em;
  min-height: 1.2em;
}

.editor {
  max-width: var(--selected-width);
  transition:
    max-width 200ms var(--ease-standard),
    width 200ms var(--ease-standard);
}

.editor-skeleton-wrapper {
  min-height: 240px;
}

.editor-skeleton {
  position: absolute;
  inset: 0;
}
</style>
