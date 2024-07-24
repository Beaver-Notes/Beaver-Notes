import OrderedList from "@tiptap/extension-ordered-list";
import FootnoteRules from "./rules";

const Footnotes = OrderedList.extend({
  name: "footnotes",
  group: "", // removed the default group of the ordered list extension
  isolating: true,
  defining: true,
  draggable: false,

  content() {
    return "footnote*";
  },
  addAttributes() {
    return {
      class: {
        default: "footnotes",
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "ol:has(.footnotes)",
        priority: 1000,
      },
    ];
  },

  addKeyboardShortcuts() {
    return {
      // override the default behavior of Mod-a:
      // rather than selecting the whole text content of the editor, only select the text inside the current footnote
      "Mod-a": ({ editor }) => {
        try {
          const { selection } = editor.state;
          const { $from } = selection;
          // footnote listItems are at depth 2, we are getting the start & end position of the parent list item from the current cursor position
          const start = $from.start(2);
          const startNode = editor.$pos(start);

          if (startNode.node.type.name != "footnote") return false;

          const end = $from.end(2);

          editor.commands.setTextSelection({
            from: start + 1,
            to: end - 1,
          });
          return true;
        } catch (e) {
          return false;
        }
      },
    };
  },
  addCommands() {
    return {};
  },
  addInputRules() {
    return [];
  },

  addExtensions() {
    return [FootnoteRules];
  },
});

export default Footnotes;
