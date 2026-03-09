import Heading from '@tiptap/extension-heading';
import {
  findParentNode,
  mergeAttributes,
  textblockTypeInputRule,
} from '@tiptap/vue-3';
import { mergeCollapsedFootnotes } from '../footnote-block/utils';

function createArrowSVG() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');

  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute(
    'd',
    'M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z'
  );

  svg.appendChild(path);
  return svg;
}

// reference: https://github.com/bangle-io/bangle-editor/blob/dev/components/base-components/src/heading.ts#L468
function findCollapseFragment(matchNode, doc) {
  // Find the last child that will be inside of the collapse
  let start = undefined;
  let end = undefined;
  let isDone = false;

  const breakCriteria = (node) => {
    if (node.type !== matchNode.type) {
      return false;
    }

    if (node.attrs['level'] <= matchNode.attrs['level']) {
      return true;
    }

    return false;
  };

  doc.forEach((node, offset, index) => {
    if (isDone) {
      return;
    }

    if (node === matchNode) {
      start = { index, offset, node };
      return;
    }

    if (start) {
      // Check if we hit a node that should end the collapse fragment
      if (breakCriteria(node)) {
        isDone = true;
        return;
      }

      // Skip footnotes list - don't include it in the collapsed content
      if (node.type.name === 'footnotes') {
        return;
      }

      end = { index, offset, node };
    }
  });

  if (!end) {
    return null;
  }

  // We are not adding parents position (doc will be parent always) to
  // the offsets since it will be 0
  const slice = doc.slice(
    start.offset + start.node.nodeSize,
    // @ts-ignore end was incorrectly inferred as "never" here
    end.offset + end.node.nodeSize
  );

  return {
    fragment: slice.content,
    start: start.offset,
    // @ts-ignore end was incorrectly inferred as "never" here
    end: end.offset + end.node.nodeSize,
  };
}

export function findAllNodesInRange(fragment, name) {
  if (!fragment) {
    return [];
  }
  if (!Array.isArray(fragment)) {
    return findAllNodesInRange(fragment.content, name);
  }
  const nodes = [];
  for (const n of fragment) {
    if (n.type.name === name) {
      nodes.push(n);
      continue;
    }
    nodes.push(...findAllNodesInRange(n.content, name));
  }
  return nodes;
}

function getCollapsedFootnote(result, state) {
  const references = findAllNodesInRange(
    result.fragment.content,
    'footnoteReference'
  );
  const footnotes = findAllNodesInRange(state.doc, 'footnotes');
  const footnotesMap = footnotes.reduce((acc, cur) => {
    for (const child of cur.content.content) {
      acc[child.attrs['data-id']] = child;
    }
    return acc;
  }, {});
  const matchList = [];
  for (const ref of references) {
    if (ref.attrs['data-id'] in footnotesMap) {
      matchList.push(footnotesMap[ref.attrs['data-id']]);
    }
  }
  return matchList;
}

function parseJSON(obj) {
  try {
    return JSON.parse(obj);
  } catch {
    return [];
  }
}

function jsonRaw(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return [];
  }
}

export default Heading.extend({
  addInputRules() {
    return this.options.levels.map((level) => {
      return textblockTypeInputRule({
        find: new RegExp(`^(#{1,${level}}) $`), // <-- Notice the trailing space only
        type: this.type,
        getAttributes: {
          level,
        },
      });
    });
  },
  addOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6],
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      open: {
        default: true,
        parseHTML: (element) => {
          return !element.hasAttribute('data-hide');
        },
        renderHTML: (attributes) => {
          // legency compatible
          if (typeof attributes.collapsedContent === 'string') {
            if (attributes.collapsedContent === '') {
              attributes.collapsedContent = null;
            } else {
              attributes.collapsedContent = parseJSON(
                attributes.collapsedContent
              );
            }
          }
          // correct open value
          attributes.open = attributes.collapsedContent == null;
          return !attributes.open ? {} : { open: '' };
        },
      },
      collapsedFootnotes: {
        default: null,
        rendered: false,
      },
      collapsedContent: {
        default: null,
        rendered: false,
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const { level = 1, ...rest } = HTMLAttributes;
    return [`h${level}`, mergeAttributes(rest), 0];
  },
  parseHTML() {
    return this.options.levels.map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    }));
  },

  addCommands() {
    return {
      ...this.parent?.(),
      collapsedHeading: () => (e) => {
        const { state, chain } = e;
        const { selection } = state;
        const currentPos = findParentNode((f) => f.type === this.type)(
          selection
        );

        if (!currentPos || !currentPos.node.attrs.open) {
          return false;
        }

        // Find the range of content that would be collapsed
        const result = findCollapseFragment(currentPos.node, state.doc);
        if (!result) {
          chain()
            .updateAttributes(this.type, {
              ...currentPos.node.attrs,
              open: false,
              collapsedContent: [],
              collapsedFootnotes: [],
            })
            .run();
          return true;
        }

        // Check for footnotes list in the content to be collapsed
        // We'll exclude it from collapsing
        let footnoteListPositions = [];

        state.doc.nodesBetween(result.start, result.end, (node, pos) => {
          if (node.type.name === 'footnotes') {
            footnoteListPositions.push({ pos, node });
          }
        });

        // If there are footnote lists in the section to be collapsed,
        // we need to exclude them from the collapse
        if (footnoteListPositions.length > 0) {
          // Create a modified fragment that excludes the footnote list
          let modifiedFragment = result.fragment;
          let newEnd = result.end;

          // Exclude footnote lists from the collapsed content
          footnoteListPositions.forEach(({ pos, node }) => {
            // Check if the footnote list is within our fragment
            if (pos >= result.start && pos <= result.end) {
              // Remove it from the fragment to be collapsed
              const nodeSize = node.nodeSize;
              const relativePos = pos - result.start;

              // Split the fragment to exclude the footnote list
              const beforeList = result.fragment.cut(0, relativePos);
              const afterList = result.fragment.cut(relativePos + nodeSize);

              // Join the fragments back without the footnote list
              modifiedFragment = beforeList.append(afterList);
              newEnd = newEnd - nodeSize;
            }
          });

          // Use the modified fragment for collapsing
          const currentNode = currentPos.node.toJSON();
          currentNode.attrs.collapsedContent = jsonRaw(
            modifiedFragment.toJSON()
          );
          currentNode.attrs.open = false;

          chain()
            .insertContentAt({ from: result.start, to: newEnd }, currentNode)
            .run();

          return true;
        }

        // If no footnote lists, proceed with normal collapsing logic
        const currentNode = currentPos.node.toJSON();
        currentNode.attrs.collapsedContent = jsonRaw(result.fragment.toJSON());
        currentNode.attrs.collapsedFootnotes = jsonRaw(
          getCollapsedFootnote(result, state)
        );
        currentNode.attrs.open = false;

        chain()
          .insertContentAt({ from: result.start, to: result.end }, currentNode)
          .run();

        return true;
      },
      unCollapsedHeading: () => (e) => {
        const { state, chain } = e;
        const { selection } = state;
        const currentPos = findParentNode((f) => f.type === this.type)(
          selection
        );
        if (!currentPos) {
          return false;
        }
        if (currentPos.node.attrs.open) {
          return false;
        }
        const currentNode = currentPos.node.toJSON();
        const collapsedContent = currentNode.attrs.collapsedContent;
        const footnotes = currentNode.attrs.collapsedFootnotes;
        const footnoteMap = (footnotes ?? []).reduce((acc, item) => {
          acc[item.attrs['data-id']] = item;
          return acc;
        }, {});
        mergeCollapsedFootnotes(jsonRaw(footnoteMap));
        currentNode.attrs.collapsedFootnotes = null;
        currentNode.attrs.collapsedContent = null;
        currentNode.attrs.open = true;
        chain()
          .insertContentAt(
            {
              from: currentPos.pos,
              to: currentPos.pos + currentPos.node.content.size + 1,
            },
            [currentNode, ...collapsedContent]
          )
          .setTextSelection(currentPos.start)
          .focus(undefined, { scollIntoView: false })
          .run();
        return true;
      },
    };
  },

  addNodeView() {
    return ({ HTMLAttributes, node, editor }) => {
      const container = document.createElement('div');
      container.style.position = 'relative';

      // Create the heading element
      const content = document.createElement(`h${node.attrs.level}`);
      content.style.marginLeft = '30px'; // Adjust based on your design
      content.style.position = 'relative';

      // Create the SVG indicator
      const indicator = createArrowSVG();
      indicator.classList.add('collapse-indicator');

      // Add styles for alignment and rotation
      indicator.style.position = 'absolute';
      indicator.style.left = '0';
      indicator.style.top = '50%';
      indicator.style.transform = 'translateY(-50%)'; // Center vertically
      indicator.style.transition = 'transform 0.3s'; // Smooth rotation transition

      // Update indicator class based on open/closed state
      const updateIndicator = () => {
        if (node.attrs.open) {
          indicator.style.transform = 'translateY(-50%) rotate(0deg)';
        } else {
          indicator.style.transform = 'translateY(-50%) rotate(90deg)';
        }
      };

      updateIndicator();

      // Toggle state on indicator click
      indicator.addEventListener('click', () => {
        if (node.attrs.open) {
          editor.commands.collapsedHeading();
        } else {
          editor.commands.unCollapsedHeading();
        }
        updateIndicator();
      });

      container.appendChild(indicator);
      container.appendChild(content);

      return {
        dom: container,
        contentDOM: content,
        ignoreMutation(e) {
          return e.type === 'selection'
            ? false
            : !container.contains(e.target) || container === e.target;
        },
        update: (r) => {
          return r.type === this.type && r.attrs.level === HTMLAttributes.level;
        },
      };
    };
  },
});
