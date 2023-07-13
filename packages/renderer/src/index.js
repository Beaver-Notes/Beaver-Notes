import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import compsUi from './lib/comps-ui';
import VRemixIcon from './lib/v-remixicon';
import './assets/css/fonts.css';
import './assets/css/tailwind.css';
import './assets/css/style.css';

const app = createApp(App);

app.config.unwrapInjectedRef = true;

app.use(router).use(createPinia()).use(compsUi).use(VRemixIcon).mount('#app');
