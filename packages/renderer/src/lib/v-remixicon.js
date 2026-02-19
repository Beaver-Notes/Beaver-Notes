import { defineComponent, h, markRaw } from 'vue';
import * as RemixIcons from '@remixicon/vue';

const toPascal = (name) => name.charAt(0).toUpperCase() + name.slice(1);

export default {
  install(app) {
    app.component(
      'v-remixicon',
      defineComponent({
        name: 'v-remixicon',
        props: {
          name: { type: String, required: true },
          size: { type: [String, Number], default: 24 },
          color: { type: String, default: 'currentColor' },
        },
        render() {
          const { name, size, color } = this;

          const IconComponent = markRaw(RemixIcons[toPascal(name)]);
          if (!IconComponent) {
            console.warn(`[v-remixicon] Unknown icon: "${name}"`);
            return h('span', {
              style: `display:inline-block;width:${size}px;height:${size}px`,
            });
          }

          return h(IconComponent, { size: String(size), color });
        },
      })
    );
  },
};
