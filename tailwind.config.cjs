const colors = require('tailwindcss/colors');
const { createThemes } = require('tw-colors');

module.exports = {
  mode: 'jit',
  content: [
    './public/**/*.html',
    './packages/renderer/**/*.{js,jsx,ts,tsx,vue,html}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      container: {
        center: true,
        padding: {
          DEFAULT: '1rem',
          sm: '2rem',
        },
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
    createThemes({
      light: {
        primary: colors.amber['400'],
        secondary: colors.amber['300'],
      },
      dark: {
        primary: colors.amber['400'],
        secondary: colors.amber['300'],
      },
      purple: {
        primary: colors.purple['400'],
        secondary: colors.purple['300'],
      },
      pink: {
        primary: colors.pink['400'],
        secondary: colors.pink['300'],
      },
      red: {
        primary: colors.rose['400'],
        secondary: colors.rose['300'],
      },
      yellow: {
        primary: colors.yellow['400'],
        secondary: colors.yellow['300'],
      },
      neutral: {
        primary: colors.neutral['400'],
        secondary: colors.neutral['300'],
      },
      green: {
        primary: colors.emerald['400'],
        secondary: colors.emerald['300'],
      },
    }),
  ],
};
