import ExpandTransition from '../components/transitions/ExpandTransition.vue';
import VTooltip from '../directives/VTooltip';
import VAutofocus from '../directives/VAutofocus';

const uiComponents = import.meta.globEager('../components/ui/*.vue');

function registerComponents(app, components, prefix) {
  Object.keys(components).forEach((path) => {
    const [fileName] = /[^/]*$/.exec(path);
    const [name] = fileName.split('.');
    const componentName = `${prefix}${name}`;

    app.component(componentName, components[path].default);
  });
}

export default function (app) {
  app.component('ExpandTransition', ExpandTransition);
  app.directive('tooltip', VTooltip);
  app.directive('autofocus', VAutofocus);

  registerComponents(app, uiComponents, 'Ui');
}
