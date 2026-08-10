import Suggestion from './suggestion';
import { useCollaboratorStore } from '@/store/collaborator';

const props = {
  showAdd: false,
  onSelect: ({ item, command }) => {
    command({ id: item.id, label: item.label });
  },
};

const UserMention = Suggestion({ name: 'userMention', props }).configure({
  HTMLAttributes: {
    class: 'user-mention',
  },
  suggestion: {
    char: '@',
    allowSpaces: false,
    items: ({ query }) => {
      const collaboratorStore = useCollaboratorStore();
      const q = query.toLowerCase();

      return collaboratorStore.usernames
        .filter(
          (item) =>
            item.username.toLowerCase().startsWith(q) ||
            (item.email && item.email.toLowerCase().startsWith(q))
        )
        .slice(0, 7);
    },
  },
});

export default UserMention;
