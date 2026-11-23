import emitter from 'tiny-emitter/instance';

// Global paywall opener (same tiny-emitter pattern as useDialog) so any
// surface — Account, sync settings, NoteActions — can ask for the dialog
// without prop drilling. Listen once from components/billing/PaywallDialog.vue.
export function usePaywall() {
  function open(reason = 'settings') {
    emitter.emit('show-paywall', { reason });
  }

  return { open };
}
