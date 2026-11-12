import { TableView } from '@tiptap/pm/tables';

export class CustomTableView extends TableView {
  constructor(node, cellMinWidth, containerAttributes) {
    super(node, cellMinWidth);

    this.containerAttributes = containerAttributes ?? {};

    // Merge block-container identity onto tableWrapper to avoid an extra
    // wrapper div per table. data-content-type drives CSS and is used by
    // sync/export code to identify table blocks. The tableWrapper class is
    // required by domCellAround, table-handle-plugin, and ignoreMutation to
    // locate the table's wrapper element.
    this.dom.setAttribute('data-content-type', 'table');
    this.dom.classList.add('tableWrapper');
    Object.entries(this.containerAttributes).forEach(([key, value]) => {
      if (key !== 'class') this.dom.setAttribute(key, value);
    });

    // Removed wrapper divs that are no longer needed:
    //  - blockContainer:    data-content-type now lives on tableWrapper directly
    //  - table-container:   redundant; tableWrapper already has overflow-x: auto
    //  - table-controls:    TableHandle is a separate editor-level component
    //  - table-selection-overlay-container: TableSelectionOverlay uses Teleport to body
    // Each removed div saves ~4 elements × 500 tables = ~2,000 DOM nodes.
  }

  ignoreMutation(mutation) {
    const target = mutation.target;
    const isInsideTable = target.closest('.tableWrapper');
    return !isInsideTable || super.ignoreMutation(mutation);
  }
}
