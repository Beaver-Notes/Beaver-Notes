import { mergeAttributes } from "@tiptap/core";
import ListItem from "@tiptap/extension-list-item";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      /**
       * scrolls to & sets the text selection at the end of the footnote with the given id
       * @param id the id of the footote (i.e. the `data-id` attribute value of the footnote)
       * @example editor.commands.focusFootnote("a43956c1-1ab8-462f-96e4-be3a4b27fd50")
       */
      focusFootnote: (id: string) => ReturnType;
    };
  }
}
const Footnote = ListItem.extend({
  name: "footnote",
  content: "paragraph+",
  isolating: true,
  defining: true,
  draggable: false,

  addAttributes() {
    return {
      id: {
        isRequired: true,
      },
      // the data-id field should match the data-id field of a footnote reference.
      // it's used to link footnotes and references together.
      "data-id": {
        isRequired: true,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "li",
        getAttrs(node) {
          const id = node.getAttribute("data-id");
          if (id) {
            return {
              "data-id": node.getAttribute("data-id"),
            };
          }
          return false;
        },
        priority: 1000,
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      focusFootnote:
        (id: string) =>
          ({ editor, chain }) => {
            const matchedFootnote = editor.$node("footnote", {
              "data-id": id,
            });
            if (matchedFootnote) {
              // sets the text selection to the end of the footnote definition and scroll to it.
              chain()
                .focus()
                .setTextSelection(
                  matchedFootnote.from + matchedFootnote.content.size,
                )
                .run();

              matchedFootnote.element.scrollIntoView();
              return true;
            }
            return false;
          },
    };
  },
  addKeyboardShortcuts() {
    return {
      // when the user presses tab, adjust the text selection to be at the end of the next footnote
      Tab: ({ editor }) => {
        try {
          const { selection } = editor.state;
          const pos = editor.$pos(selection.anchor);
          if (!pos.after) return false;
          // if the next node  is "footnotes", place the text selection at the end of the first footnote
          if (pos.after.node.type.name == "footnotes") {
            const firstChild = pos.after.node.child(0);
            editor
              .chain()
              .setTextSelection(pos.after.from + firstChild.content.size)
              .scrollIntoView()
              .run();
            return true;
          } else {
            const startPos = selection.$from.start(2);
            if (Number.isNaN(startPos)) return false;
            const parent = editor.$pos(startPos);
            if (parent.node.type.name != "footnote" || !parent.after) {
              return false;
            }
            // if the next node is a footnote, place the text selection at the end of it
            editor
              .chain()
              .setTextSelection(parent.after.to - 1)
              .scrollIntoView()
              .run();
            return true;
          }
        } catch {
          return false;
        }
      },
      // inverse of the tab command - place the text selection at the end of the previous footnote
      "Shift-Tab": ({ editor }) => {
        const { selection } = editor.state;
        const startPos = selection.$from.start(2);
        if (Number.isNaN(startPos)) return false;
        const parent = editor.$pos(startPos);
        if (parent.node.type.name != "footnote" || !parent.before) {
          return false;
        }

        editor
          .chain()
          .setTextSelection(parent.before.to - 1)
          .scrollIntoView()
          .run();
        return true;
      },
    };
  },
});

export default Footnote;
