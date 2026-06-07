export const colors = {
  // Backgrounds
  bg: {
    base: '#0A0A0F', // Main app background
    surface: '#111117', // Cards, sidebars, modals
    surfaceHover: '#1A1A24', // Hover states
    surfaceElevated: '#1E1E2A', // Popovers, tooltips
  },
  // Typography
  text: {
    primary: '#FFFFFF',
    secondary: '#A1A1AA', // zinc-400
    tertiary: '#71717A', // zinc-500
    muted: '#52525B', // zinc-600
  },
  // Borders
  border: {
    subtle: 'rgba(255, 255, 255, 0.04)',
    base: 'rgba(255, 255, 255, 0.08)',
    strong: 'rgba(255, 255, 255, 0.15)',
  },
  // Brand / Actions
  primary: {
    base: '#F5A623', // violet-500
    hover: '#7C3AED', // violet-600
    subtle: 'rgba(139, 92, 246, 0.1)',
    subtleHover: 'rgba(139, 92, 246, 0.2)',
  },
  // Status
  success: {
    base: '#10B981', // emerald-500
    subtle: 'rgba(16, 185, 129, 0.1)',
  },
  warning: {
    base: '#F59E0B', // amber-500
    subtle: 'rgba(245, 158, 11, 0.1)',
  },
  danger: {
    base: '#EF4444', // red-500
    subtle: 'rgba(239, 68, 68, 0.1)',
  },
  info: {
    base: '#3B82F6', // blue-500
    subtle: 'rgba(59, 130, 246, 0.1)',
  }
} as const;
