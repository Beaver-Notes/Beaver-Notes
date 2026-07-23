import FileEmbedComponent from './FileEmbedComponent.vue';
import { createFileBlock } from '../create-file-block';

export default createFileBlock({
  name: 'fileEmbed',
  commandName: 'setFileEmbed',
  component: FileEmbedComponent,
});
