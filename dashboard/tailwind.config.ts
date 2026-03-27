import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0F0F1A', card: '#1A1A2E', border: '#2D3142' },
        accent: '#00D9FF',
        profit: '#00FF41',
        loss: '#FF3366',
        muted: '#8892B0',
      },
      fontFamily: {
        mono: ['Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      // Mobile-first breakpoints for responsive trading dashboard
      screens: {
        'sm': '640px',   // Mobile landscape
        'md': '768px',   // Tablet
        'lg': '1024px',  // Laptop
        'xl': '1280px',  // Desktop
        '2xl': '1536px', // Large desktop
      },
      // Touch-friendly sizing
      minHeight: {
        'touch': '44px', // Minimum tap target size
      },
      minWidth: {
        'touch': '44px', // Minimum tap target size
      },
    },
  },
  plugins: [],
} satisfies Config;
