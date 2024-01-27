import Suggestion from './suggestion';
import { useLabelStore } from '@/store/label';

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

const LabelSuggestion = Suggestion({ name: 'noteLabel', props }).configure({
  HTMLAttributes: {
    class: 'mention',
  },
  suggestion: {
    char: '#',
    items: (query) => {
      const labelStore = useLabelStore();

      return labelStore.data
        .filter((item) => item.toLowerCase().startsWith(query.toLowerCase()))
        .slice(0, 7);
    },
  },
});

export default LabelSuggestion;
