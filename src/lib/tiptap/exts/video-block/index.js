import VideoComponent from './VideoComponent.vue';
import { createFileBlock } from '../create-file-block';
import { sanitizeMediaSource } from '@/utils/note/contentSecurity.js';

const Video = createFileBlock({
  name: 'Video',
  commandName: 'setVideo',
  component: VideoComponent,
  extraAttrs: ['width', 'layout'],
});

export default Video.extend({
  parseHTML() {
    return [
      ...this.parent(),
      {
        tag: 'video',
        getAttrs: (el) => {
          const raw = el.getAttribute('src') || '';
          const src = sanitizeMediaSource(raw);
          if (raw && !src) return false;
          return { src };
        },
      },
    ];
  },
});
