import { createCallout } from './createCallout.js';

export const blueCallout = createCallout({
  color: 'blue',
  cssClass: 'p-1 blueCallout border-l-4 border-blue-300 pl-4 bg-blue-500 bg-opacity-10',
});

export const yellowCallout = createCallout({
  color: 'yellow',
  cssClass: 'p-1 yellowCallout border-l-4 border-yellow-300 pl-4 bg-yellow-500 bg-opacity-10',
});

export const redCallout = createCallout({
  color: 'red',
  cssClass: 'p-1 redCallout border-l-4 border-red-300 pl-4 bg-red-500 bg-opacity-10',
});

export const purpleCallout = createCallout({
  color: 'purple',
  cssClass: 'p-1 purpleCallout border-l-4 border-purple-300 pl-4 bg-purple-500 bg-opacity-10',
});

export const blackCallout = createCallout({
  color: 'black',
  cssClass:
    'p-1 blackCallout border-l-4 border-gray-700 dark:border-gray-500 pl-4 bg-gray-900 dark:bg-gray-400 dark:bg-opacity-10 bg-opacity-10',
});

export const greenCallout = createCallout({
  color: 'green',
  cssClass:
    'p-1 greenCallout border-l-4 border-green-700 dark:border-green-500 pl-4 bg-green-900 dark:bg-green-400 dark:bg-opacity-10 bg-opacity-10',
});

export default {
  blueCallout,
  yellowCallout,
  redCallout,
  purpleCallout,
  blackCallout,
  greenCallout,
};
