import { Heading } from '@tiptap/extension-heading';
import { textblockTypeInputRule } from '@tiptap/vue-3';

const heading = Heading.extend({
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
});

export default heading;
