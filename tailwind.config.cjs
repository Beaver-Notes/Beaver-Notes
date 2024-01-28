const colors = require('tailwindcss/colors');

module.exports = {
  mode: 'jit',
  purge: ['./public/**/*.html', './packages/renderer/**/*.{js,jsx,ts,tsx,vue,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily:{
        'primary': ['Arimo'],
        'arimo': ['Arimo'],
        'avenir': ['Avenir'],
        'eb-garamond': ['EB Garamond'],
        'helvetica': ['Helvetica', 'sans-serif'],
        'open-dyslexic': ['Open Dyslexic'],
        'ubuntu': ['Ubuntu']
      },
      colors: {
        primary: colors.amber['400'],
        secondary: colors.amber ['300'],
        gray: colors.gray,
        amber: {
          '50': '#FFFBEB',
          '100': '#FEF3C7',
          '200': '#FDE68A',
          '300': '#FCD34D',
          '400': '#FBBF24',
          '500': '#F59E0B',
          '600': '#D97706',
          '700': '#B45309',
          '800': '#92400E',
          '900': '#78350F',
        },
      },
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
  ],
};
