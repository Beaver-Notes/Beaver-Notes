# Folder Customize vs Actions Redesign — Design

> **Date:** 2026-08-24
> **Status:** Approved

## 1. Goal & Scope
Re-split folder UX so Customize (name/color/emoji) and Actions (Archive/Move/Delete) never share a modal. Desktop `…` becomes a Popover action menu; mobile uses long-press → Actions bar with Customize entry. `FolderCustomizeModal` shrinks to 3 inputs only. Eliminates nested-modal stacking (z-50/60/70 competition) and reduces cognitive load (10+ controls → 3).

Out of scope: folder creation flow, note actions, share.

## 2. Architecture & Components
- **FolderCustomizeModal.vue** — keep: `ui-input` name, 7 color swatches (`FOLDER_ICON_COLORS`), `EmojiPicker` (lazy when open), Cancel/Save in `#actions` (`mobile:flex-col-reverse`). Remove: Actions block (Archive/Move/Delete), nested `<folder-tree>`, `suspendedForChild` watch, `deleteFolder`/`onMoved`/`toggleArchive`. Keep `overlayClass z-50` default.
- **HomeFolderCard.vue** — center emoji/title still → `openCustomizeModal()`. Change `…` button (currently `mobile:hidden` + opens customize) to Popover trigger visible on desktop only, rendering: Archive toggle (folderStore.archive/unarchive), Move → `FolderTree` modal, Delete → `Dialog` confirm. Own `showActionMenu`/`showMove` state; close popover before opening child modal (sequential, no stack).
- **Actions.vue** — remove `mobile:hidden` on `selectedItems` bar, make visible on mobile (`mobile:block` + `bottom-[calc(var(--app-keyboard-inset-bottom)+...]`). Add Customize button (first slot) emitting `customize` when `selectedFolders.length===1` (hide when `>1`). Hide Bookmark/Lock buttons when selection contains folders (already `v-if="selectedNotes.length>0"` guards; add explicit hide when folders present). Emits: `customize`, `move`, `delete`, `clear`.
- **Modal.vue/Dialog.vue/FolderTree.vue** — `overlayClass` prop kept, defaults revert to `z-50` (elevated guard not needed once nesting removed, but safe to keep).

## 3. Interaction Flows
- **Desktop customize:** tap folder emoji/title → thin modal → Save/Cancel. No actions.
- **Desktop actions:** tap `…` → Popover → Archive (instant), Move (closes popover → shows `FolderTree`), Delete (closes popover → shows `Dialog` confirm).
- **Mobile:** long-press/select folder → `selectedItems` Set → `Actions.vue` slides up (single row, overflow handled) showing Customize (single only) + Archive/Move/Delete + Clear. Tap Customize → thin modal. Move/Delete via same `FolderTree`/`Dialog` triggered from bar. Tap outside/Clear dismisses.

## 4. Data Flow
`HomeFolderCard` reads `folder` prop, `FolderCustomizeModal` emits `saved(id)`. `Actions.vue` derives `selectedFolders`/`selectedNotes` via `parseItemId` + stores, computes `shouldArchive`. Moves go through `folderStore.move(id, targetId)` or `noteStore.moveToFolder(ids, targetId)`; deletes via `folderStore.delete(id, {deleteContents:true})`.

## 5. Edge Cases
- Customize hidden when `selectedFolders.length !== 1` (multi-select) or mixed selection with notes >1.
- Move disabled for descendants (`disabledTargetIds` subtree).
- Cancelled dialogs leave parent unchanged; successful move/delete keep bars closed.
- No stacked backdrops — single overlay at a time, ESC / backdrop dismiss unambiguous.

## 6. Testing
- Existing vitests for `FolderCustomizeModal`/`FolderTree` pass (thin modal never opens nested).
- New `Actions.vue` spec: single folder → Customize visible, multi folders → hidden, mixed → Bookmark hidden.
- Manual: desktop popover opens/closes, mobile long-press bar appears, move/delete confirm above bar.

## 7. Constraints
- Use existing `Popover`, `Modal`, `Dialog`, `FolderTree` — no new deps.
- Keep `mobile:flex-col-reverse` 48px targets for sheet buttons (prior fix).
- No change to folder creation (parentId flow).
