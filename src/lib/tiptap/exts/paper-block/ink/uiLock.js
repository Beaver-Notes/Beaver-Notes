/**
 * uiLock.js — app-chrome lock while ink owns the pointer (Apple A7).
 * A single reactive flag; hosts consume it to make toolbars/sidebars inert
 * during a stroke. Kept dependency-free on purpose.
 */
import { ref } from 'vue';

export const inkStrokeActive = ref(false);
