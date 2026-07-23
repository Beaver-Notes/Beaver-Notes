import VideoComponent from './VideoComponent.vue';
import { createFileBlock } from '../create-file-block';

export default createFileBlock({
  name: 'Video',
  commandName: 'setVideo',
  component: VideoComponent,
});
