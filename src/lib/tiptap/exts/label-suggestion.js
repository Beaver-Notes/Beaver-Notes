import Suggestion from './suggestion';
import { useLabelStore } from '@/store/label';
import { VueRenderer } from '@tiptap/vue-3';
import LabelNodeView from './label-suggestion/LabelNodeView.vue';

const props = {
  showAdd: true,
  onAdd: (query, command) => {
    const labelStore = useLabelStore();

    labelStore.add(query).then((name) => {
      command({ id: name });
    });
  },
  onSelect: ({ item, command }) => {
    command({ id: item });
  },
};

// addNodeView must live on the node DEFINITION, so it is passed through the
// factory's `configure` param (spread into Node.create). TipTap's
// `.configure()` below only merges into options and would silently drop it.
const LabelSuggestion = Suggestion({
  name: 'noteLabel',
  props,
  configure: {
    addNodeView() {
      return ({ node }) => {
        const component = new VueRenderer(LabelNodeView, {
          props: { node },
          editor: this.editor,
        });
        return {
          dom: component.element,
          destroy: () => component.destroy(),
        };
      };
    },
  },
}).configure({
  HTMLAttributes: {
    class: 'mention',
  },
  suggestion: {
    char: '#',
    items: ({ query }) => {
      const labelStore = useLabelStore();

      return labelStore.data
        .filter((item) => item.toLowerCase().startsWith(query.toLowerCase()))
        .slice(0, 7);
    },
  },
});

export default LabelSuggestion;
