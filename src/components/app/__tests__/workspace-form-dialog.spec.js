import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@/composable/useTranslations', () => ({
  useTranslations: () => ({ translations: { value: {} } }),
}));

import WorkspaceFormDialog from '../WorkspaceFormDialog.vue';
import {
  CUSTOMIZE_DEFAULT_COLOR,
  WORKSPACE_QUICK_ICONS,
  WORKSPACE_DEFAULT_EMOJI,
} from '@/lib/customize';

// The shared editor is stubbed: it keeps an internal draft so the wrapper's
// save/error plumbing is exercised without loading the emoji dataset.
const EditorStub = {
  name: 'UiCustomizeEditorStub',
  props: [
    'modelValue',
    'initialName',
    'initialColor',
    'initialIcon',
    'quickIcons',
    'saving',
    'error',
    'overlayClass',
    'persist',
  ],
  emits: ['update:modelValue', 'close', 'save'],
  data() {
    return { draft: this.initialName || '', draftColor: this.initialColor };
  },
  watch: {
    initialName(v) {
      this.draft = v || '';
    },
    initialColor(v) {
      this.draftColor = v;
    },
  },
  template: `<div>
    <input :value="draft" @input="draft = $event.target.value" />
    <input type="color" :value="draftColor" @input="draftColor = $event.target.value" />
    <button type="button" :disabled="saving" @click="$emit(&quot;save&quot;, { name: draft, color: draftColor, icon: initialIcon })">Create</button>
    <div v-if="error" role="alert">{{ error }}</div>
  </div>`,
};

function mountDialog({ submitHandler, workspace = null, show = true } = {}) {
  return mount(WorkspaceFormDialog, {
    props: { show, mode: workspace ? 'edit' : 'create', workspace, submitHandler },
    global: {
      stubs: {
        'ui-customize-editor': EditorStub,
        'v-remixicon': true,
      },
    },
  });
}

function editor(wrapper) {
  return wrapper.findComponent(EditorStub);
}

function createButton(wrapper) {
  return wrapper.findAll('button').find((b) => ['Create', 'Save'].includes(b.text()));
}

describe('WorkspaceFormDialog submit lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears loading and emits close after a successful create', async () => {
    const submitHandler = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    expect(submitHandler).toHaveBeenCalledTimes(1);
    expect(submitHandler.mock.calls[0][0]).toEqual({
      name: 'Test',
      emoji: WORKSPACE_DEFAULT_EMOJI,
      color: CUSTOMIZE_DEFAULT_COLOR,
    });
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(editor(wrapper).props('saving')).toBe(false);
  });

  it('surfaces the error inline and clears loading after a failed create', async () => {
    const submitHandler = vi.fn().mockRejectedValue(new Error('plan upgrade required'));
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('plan upgrade required');
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(editor(wrapper).props('saving')).toBe(false);
  });

  it('creates with default emoji and colour when only a name is given', async () => {
    const submitHandler = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Just a name');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    const payload = submitHandler.mock.calls[0][0];
    expect(payload.name).toBe('Just a name');
    expect(payload.emoji).toBe(WORKSPACE_DEFAULT_EMOJI);
    expect(payload.color).toBe(CUSTOMIZE_DEFAULT_COLOR);
  });

  it('does not stay stuck on a stale loading state when reopened after a failed create', async () => {
    const submitHandler = vi.fn().mockRejectedValue(new Error('boom'));
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);

    await wrapper.setProps({ show: false });
    await wrapper.setProps({ show: true });
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAll('button[disabled]')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('...');
  });

  it('prefills the editor from the workspace in edit mode', async () => {
    const wrapper = mountDialog({
      workspace: { id: 'w1', name: 'Team', emoji: '🚀', color: '#3b82f6' },
    });
    await flushPromises();

    expect(wrapper.find('input').element.value).toBe('Team');
    expect(editor(wrapper).props('initialColor')).toBe('#3b82f6');
    expect(editor(wrapper).props('initialIcon')).toBe('🚀');
  });
});

describe('WorkspaceFormDialog redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the 8 shared quick icons, z-[70] overlay and persist to the editor', () => {
    const wrapper = mountDialog();
    const props = editor(wrapper).props();
    expect(props.quickIcons).toEqual([...WORKSPACE_QUICK_ICONS]);
    expect(props.quickIcons).toHaveLength(8);
    expect(props.overlayClass).toBe('z-[70]');
    expect(props.persist).toBe(true);
  });

  it('applies a custom color picked via the color input to the submit payload', async () => {
    const submitHandler = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input[type="color"]').setValue('#123456');
    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');
    await flushPromises();

    expect(submitHandler.mock.calls[0][0].color).toBe('#123456');
  });

  it('shows an honest loading state through the editor, not "..." text', async () => {
    const submitHandler = vi.fn().mockReturnValue(new Promise(() => {}));
    const wrapper = mountDialog({ submitHandler });

    await wrapper.find('input').setValue('Test');
    await createButton(wrapper).trigger('click');

    expect(editor(wrapper).props('saving')).toBe(true);
    expect(wrapper.findAll('button[disabled]').length).toBeGreaterThan(0);
    expect(wrapper.text()).not.toContain('...');
    await flushPromises();
  });

  it('keeps the inline error and never submits when the name is empty', async () => {
    const submitHandler = vi.fn();
    const wrapper = mountDialog({ submitHandler });

    await createButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(submitHandler).not.toHaveBeenCalled();
  });
});
