import { mergeAttributes, Node } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { v4 as uuid } from "uuid";

const REFNUM_ATTR = "data-reference-number";
const REF_CLASS = "footnote-ref";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnoteReference: {
      /**
       * add a new footnote reference
       * @example editor.commands.addFootnote()
       */
      addFootnote: () => ReturnType;
    };
  }
}

const FootnoteReference = Node.create({
  name: "footnoteReference",
  inline: true,
  content: "text*",
  group: "inline",
  atom: true,
  draggable: true,

  parseHTML() {
    return [
      {
        tag: `sup a.${REF_CLASS}`,
        priority: 1000,
      },
    ];
  },

  addAttributes() {
    return {
      class: {
        default: REF_CLASS,
      },
      "data-id": {
        parseHTML(element) {
          return element.getAttribute("data-id") || uuid();
        },
        renderHTML(attributes) {
          return {
            "data-id": attributes["data-id"] || uuid(),
          };
        },
      },
      referenceNumber: {
        parseHTML(element) {
          return element.getAttribute(REFNUM_ATTR) || element.innerText;
        },
      },
      href: {
        renderHTML(attributes) {
          return {
            href: `#fn:${attributes["referenceNumber"]}`,
          };
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const { referenceNumber, ...attributes } = HTMLAttributes;
    const attrs = mergeAttributes(this.options.HTMLAttributes, attributes);
    attrs[REFNUM_ATTR] = referenceNumber;

    return [
      "sup",
      { id: `fnref:${referenceNumber}` },
      ["a", attrs, HTMLAttributes.referenceNumber],
    ];
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: new PluginKey("footnoteRefClick"),

        props: {
          // on double-click, focus on the footnote
          handleDoubleClickOn(view, pos, node, nodePos, event) {
            if (node.type.name != "footnoteReference") return false;
            event.preventDefault();
            const id = node.attrs["data-id"];
            return editor.commands.focusFootnote(id);
          },
          // click the footnote reference once to get focus, click twice to scroll to the footnote
          handleClickOn(view, pos, node, nodePos, event) {
            if (node.type.name != "footnoteReference") return false;
            event.preventDefault();
            const { selection } = editor.state.tr;
            if (selection instanceof NodeSelection && selection.node.eq(node)) {
              const id = node.attrs["data-id"];
              return editor.commands.focusFootnote(id);
            } else {
              editor.chain().setNodeSelection(nodePos).run();
              return true;
            }
          },

          // Handle paste events
          handlePaste(view, event, slice) {
            // Extract text from pasted content
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;

            // Find all footnote reference patterns in the pasted text
            const footnoteRefs = [];
            const regex = /\[\^(\d+)\]/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
              footnoteRefs.push({
                number: match[1],
                index: match.index,
                length: match[0].length,
              });
            }

            // Process the text to replace footnote references with footnote nodes
            let offset = 0;
            let newText = text;
            footnoteRefs.forEach(({ number, index, length }) => {
              const refNode = `<sup id="fnref:${number}"><a class="${REF_CLASS}" href="#fn:${number}" data-reference-number="${number}">${number}</a></sup>`;
              newText = newText.slice(0, index + offset) + refNode + newText.slice(index + offset + length);
              offset += refNode.length - length;
            });

            // Insert the processed content into the editor
            const { tr } = view.state;
            tr.replaceSelectionWith(view.state.schema.text(newText));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      addFootnote:
        () =>
          ({ state, tr }) => {
            const node = this.type.create({
              "data-id": uuid(),
            });
            tr.insert(state.selection.anchor, node);
            return true;
          },
    };
  },

  addInputRules() {
    return [
      {
        find: /(^|\s)\[\^(\d+)\]$/, // Adjust regex to match [^1] only at the end of a line or surrounded by whitespace
        type: this.type,
        handler({ range, match, chain }) {
          const start = range.from;
          const end = range.to;

          if (match[2]) {
            chain().deleteRange({ from: start, to: end }).addFootnote().run();
          }
        },
      },
    ];
  },
});

export default FootnoteReference;
