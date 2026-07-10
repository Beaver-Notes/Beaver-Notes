import { TableView } from '@tiptap/pm/tables';

export class CustomTableView extends TableView {
  constructor(node, cellMinWidth, containerAttributes) {
    super(node, cellMinWidth);

    this.containerAttributes = containerAttributes ?? {};

    this.blockContainer = document.createElement('div');
    this.blockContainer.setAttribute('data-content-type', 'table');
    Object.entries(this.containerAttributes).forEach(([key, value]) => {
      if (key !== 'class') this.blockContainer.setAttribute(key, value);
    });

    this.innerTableContainer = document.createElement('div');
    this.innerTableContainer.className = 'table-container';

    this.widgetsContainer = document.createElement('div');
    this.widgetsContainer.className = 'table-controls';
    this.widgetsContainer.style.position = 'relative';

    this.overlayContainer = document.createElement('div');
    this.overlayContainer.className = 'table-selection-overlay-container';

    const originalTable = this.dom;
    const tableElement = originalTable.firstChild;

    this.innerTableContainer.appendChild(tableElement);
    originalTable.appendChild(this.innerTableContainer);
    originalTable.appendChild(this.widgetsContainer);
    originalTable.appendChild(this.overlayContainer);

    this.blockContainer.appendChild(originalTable);
    this.dom = this.blockContainer;
  }

  ignoreMutation(mutation) {
    const target = mutation.target;
    const isInsideTable = target.closest('.table-container');
    return !isInsideTable || super.ignoreMutation(mutation);
  }
}
