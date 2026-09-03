/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold:  { DEFAULT: '#f5c842', dim: '#c9a42a' },
        csgo:  { bg: '#1b2838', card: '#2a475e', highlight: '#66c0f4' },
        ash:   { dark: '#0a0a0a', mid: '#111', light: '#1a1a1a' },
      },
      keyframes: {
        rouletteSpin: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(var(--spin-distance))' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        winnerPop: {
          '0%':   { transform: 'scale(1)' },
          '50%':  { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        roulette:  'rouletteSpin var(--spin-duration) cubic-bezier(0.12, 0, 0.08, 1) forwards',
        fadeIn:    'fadeIn 0.4s ease forwards',
        winnerPop: 'winnerPop 0.5s ease',
      },
    },
  },
  plugins: [],
};
