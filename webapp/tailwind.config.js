/** MosaVali design tokens. See src/design/README.md for usage rules. */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['FiraGO', '"Noto Sans Georgian"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0A0A0A',
        paper: '#FFFFFF',
        canvas: '#F5F5F2',
        // Dark surfaces, from page background (DEFAULT) to the most raised layer.
        night: {
          DEFAULT: '#050606',
          1: '#0E100F',
          2: '#151817',
          3: '#1D2120',
          4: '#272B2A',
        },
        line: { DEFAULT: '#E7E7E2', night: '#2E3332' },
        mute: { DEFAULT: '#646866', night: '#9AA19E' },
        // The only accent color. Means "safe / protected / on track".
        accent: {
          50: '#ECF8F1',
          100: '#D2F0DF',
          300: '#86D9AE',
          400: '#4FC48A',
          500: '#2FA86F',
          600: '#21875A',
          700: '#1B6B48',
        },
        // Used only for "above your risk capacity" and things that need attention.
        caution: {
          50: '#FDF6E7',
          100: '#FBEFD6',
          300: '#F4C56E',
          400: '#E9AC45',
          500: '#D18F22',
          700: '#8A5A0F',
        },
      },
      fontSize: {
        // Marketing display sizes: large, thin, tight.
        'display-xl': ['clamp(2.4rem, 5.4vw, 5.25rem)', { lineHeight: '1.04', letterSpacing: '-0.045em', fontWeight: '300' }],
        display: ['clamp(2.25rem, 5vw, 4.25rem)', { lineHeight: '1.06', letterSpacing: '-0.04em', fontWeight: '300' }],
        title: ['clamp(1.75rem, 3vw, 2.5rem)', { lineHeight: '1.12', letterSpacing: '-0.03em', fontWeight: '400' }],
        // App sizes.
        figure: ['2.75rem', { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '300' }],
        'figure-sm': ['1.75rem', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '400' }],
        heading: ['1.375rem', { lineHeight: '1.25', letterSpacing: '-0.02em', fontWeight: '500' }],
        'body-lg': ['1.125rem', { lineHeight: '1.6' }],
        body: ['1rem', { lineHeight: '1.55' }],
        label: ['0.875rem', { lineHeight: '1.4' }],
        micro: ['0.75rem', { lineHeight: '1.35' }],
      },
      borderRadius: {
        card: '1.5rem',
        'card-lg': '2rem',
      },
      spacing: {
        tap: '2.75rem', // 44px minimum tap target
        section: 'clamp(5rem, 12vw, 10rem)',
      },
      maxWidth: { page: '80rem' },
      boxShadow: {
        device: '0 50px 100px -20px rgba(10,10,10,0.35), 0 30px 60px -30px rgba(10,10,10,0.45)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.9s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
