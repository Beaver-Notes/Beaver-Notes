import Suggestion from './suggestion';
import { useLabelStore } from '@/store/label';

const props = {
  showAdd: true,
  onAdd: (query, command) => {
    const labelStore = useLabelStore();

    // For simplicity, you can define a default color here or fetch it from somewhere else
    const color = 'green';

    labelStore.add({ name: query, color }).then((name) => {
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
    items: ({ query }) => {
      const labelStore = useLabelStore();

      return labelStore.data
        .filter((item) => {
          const itemAsString = String(item);
          return itemAsString.toLowerCase().startsWith(query.toLowerCase());
        })
        .slice(0, 7);
    },
  },
});

export default LabelSuggestion;
