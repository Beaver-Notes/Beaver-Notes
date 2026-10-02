import VideoComponent from './VideoComponent.vue';
import { createFileBlock } from '../create-file-block';

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
        getAttrs: (el) => ({ src: el.getAttribute('src') }),
      },
    ];
  },
});
