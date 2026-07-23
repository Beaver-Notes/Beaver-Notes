import AudioComponent from './AudioComponent.vue';
import { createFileBlock } from '../create-file-block';

export default createFileBlock({
  name: 'Audio',
  commandName: 'setAudio',
  component: AudioComponent,
});
