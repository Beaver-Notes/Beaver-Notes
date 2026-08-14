import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

const {
  promptMock,
  alertMock,
  lockNoteMock,
  setAppPasswordMock,
  verifyPassphraseMock,
} = vi.hoisted(() => ({
  promptMock: vi.fn(),
  alertMock: vi.fn(),
  lockNoteMock: vi.fn(),
  setAppPasswordMock: vi.fn(),
  verifyPassphraseMock: vi.fn(),
}));

vi.mock('@/composable/useNoteMenu', () => ({
  useNoteMenu: () => ({
    store: { inReaderMode: false },
    translations: { menu: { share: '', readerMode: '' } },
    shareActions: [],
    toggleReaderMode: vi.fn(),
    deleteNode: vi.fn(),
    lockNote: vi.fn(),
    toggleBookmark: vi.fn(),
    toggleArchive: vi.fn(),
    toggleFullWidth: vi.fn(),
    copyNoteContent: vi.fn(),
  }),
}));
vi.mock('@/store/note', () => ({
  useNoteStore: () => ({ update: vi.fn(), lockNote: lockNoteMock }),
}));
vi.mock('@/store/account', () => ({
  useAccountStore: () => ({ isAuthenticated: false }),
}));
vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({
    translations: { value: { card: {}, dialog: {}, settings: {} } },
  }),
}));
vi.mock('@/composable/useClipboard', () => ({
  useClipboard: () => ({ copyState: 0, copyToClipboard: vi.fn() }),
}));
vi.mock('@/store/passwd', () => ({
  usePasswordStore: () => ({
    retrieve: vi.fn().mockResolvedValue(''),
    setAppPassword: setAppPasswordMock,
  }),
}));
vi.mock('@/utils/crypto/encryption.js', () => ({
  verifyPassphrase: verifyPassphraseMock,
}));
vi.mock('@/lib/dialog', () => ({
  useDialog: () => ({ prompt: promptMock, alert: alertMock }),
}));

import NoteActions from '../NoteActions.vue';

const baseProps = {
  editor: {
    chain: () => ({
      focus: () => ({
        undo: () => ({ run: vi.fn() }),
        redo: () => ({ run: vi.fn() }),
      }),
    }),
    getText: () => '',
  },
  id: 'n1',
  note: { id: 'n1', isBookmarked: false, isArchived: false, isFullWidth: false },
  goBack: vi.fn(),
};

function mountActions() {
  return mount(NoteActions, {
    props: baseProps,
    global: {
      stubs: [
        'ui-popover',
        'ui-list',
        'ui-list-item',
        'ui-switch',
        'ui-modal',
        'presence-avatars',
        'share-modal',
        'history-panel',
        'v-remixicon',
      ],
    },
  });
}

describe('NoteActions lock', () => {
  beforeEach(() => {
    promptMock.mockReset();
    alertMock.mockReset();
    lockNoteMock.mockReset();
    setAppPasswordMock.mockReset();
    verifyPassphraseMock.mockReset();
  });

  it('locks via the workspace passphrase without an app password', async () => {
    verifyPassphraseMock.mockResolvedValue({ ok: true });
    const wrapper = mountActions();

    wrapper.vm.lockNote();
    await Promise.resolve();

    const promptOptions = promptMock.mock.calls[0][0];
    expect(promptOptions).toBeDefined();
    expect(promptOptions.password).toBe(true);

    await promptOptions.onConfirm('my-passphrase');

    expect(verifyPassphraseMock).toHaveBeenCalledWith('my-passphrase');
    expect(lockNoteMock).toHaveBeenCalledWith('n1');
    expect(setAppPasswordMock).not.toHaveBeenCalled();
  });

  it('alerts on a wrong passphrase and does not lock', async () => {
    verifyPassphraseMock.mockResolvedValue({ ok: false, error: 'bad' });
    const wrapper = mountActions();

    wrapper.vm.lockNote();
    await Promise.resolve();

    const promptOptions = promptMock.mock.calls[0][0];
    expect(promptOptions).toBeDefined();

    await promptOptions.onConfirm('wrong-passphrase');

    expect(alertMock).toHaveBeenCalled();
    expect(lockNoteMock).not.toHaveBeenCalled();
  });
});
