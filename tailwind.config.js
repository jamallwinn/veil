/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Noir Luxury Palette
        obsidian: '#0a0a0b',
        charcoal: '#131315',
        graphite: '#1a1a1c',
        slate: '#2a2a2e',
        steel: '#3a3a3e',

        platinum: {
          DEFAULT: '#e8e4dd',
          dim: '#a8a4a0',
          muted: '#6a6864',
        },

        gold: {
          DEFAULT: '#c9a962',
          dim: '#8a7545',
          bright: '#e4c87a',
        },

        teal: {
          DEFAULT: '#4a7a7a',
          bright: '#5a9a9a',
          dim: '#3a5a5a',
        },

        danger: {
          DEFAULT: '#a65454',
          bright: '#c46464',
        },

        success: {
          DEFAULT: '#5a8a5a',
          bright: '#6aa86a',
        },
      },

      fontFamily: {
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        body: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },

      fontSize: {
        xs: '0.64rem',
        sm: '0.8rem',
        base: '1rem',
        lg: '1.25rem',
        xl: '1.5625rem',
        '2xl': '1.953rem',
        '3xl': '2.441rem',
        '4xl': '3.052rem',
      },

      spacing: {
        18: '4.5rem',
        22: '5.5rem',
      },

      borderRadius: {
        sm: '0.25rem',
        md: '0.5rem',
        lg: '1rem',
        xl: '1.5rem',
      },

      boxShadow: {
        gold: '0 8px 24px rgba(201, 169, 98, 0.2)',
        teal: '0 0 0 3px rgba(74, 122, 122, 0.15)',
        platinum: '0 8px 24px rgba(232, 228, 221, 0.1)',
      },

      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        'out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },

      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'fade-in-up': 'fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        pulse: 'pulse 2s infinite',
        spin: 'spin 0.8s linear infinite',
      },

      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeInUp: {
          from: {
            opacity: '0',
            transform: 'translateY(20px)',
          },
          to: {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        scaleIn: {
          from: {
            opacity: '0',
            transform: 'scale(0.9)',
          },
          to: {
            opacity: '1',
            transform: 'scale(1)',
          },
        },
        pulse: {
          '0%, 100%': {
            boxShadow: '0 0 0 0 rgba(90, 154, 154, 0.4)',
          },
          '50%': {
            boxShadow: '0 0 0 8px rgba(90, 154, 154, 0)',
          },
        },
      },
    },
  },
  plugins: [],
};
