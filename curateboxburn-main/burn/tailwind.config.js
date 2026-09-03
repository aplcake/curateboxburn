/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        burn:  { DEFAULT: '#ff4400', dim: '#cc3300', glow: '#ff6633' },
        ash:   { DEFAULT: '#1a1a1a', mid: '#111', dark: '#0a0a0a' },
        ember: '#ff9933',
      },
      fontFamily: { mono: ['var(--font-mono)', 'monospace'] },
      boxShadow: {
        burn:  '0 0 20px rgba(255,68,0,0.4)',
        burnLg:'0 0 40px rgba(255,68,0,0.6)',
      },
    },
  },
  plugins: [],
};
