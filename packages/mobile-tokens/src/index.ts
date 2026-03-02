import { DEFAULT_THEME } from '../../shared/src/config/theme';

export type ColorMode = 'light' | 'dark';

export interface SemanticColorTokens {
  background: string;
  foreground: string;
  accent: string;
  info: string;
  success: string;
  destructive: string;
}

export interface SurfaceColorTokens {
  paper: string;
  navigator: string;
  input: string;
  popover: string;
  popoverSolid: string;
}

function withFallback(value: string | undefined, fallback: string): string {
  return value ?? fallback;
}

const lightSemanticColors: SemanticColorTokens = {
  background: withFallback(DEFAULT_THEME.background, 'oklch(0.98 0.003 265)'),
  foreground: withFallback(DEFAULT_THEME.foreground, 'oklch(0.185 0.01 270)'),
  accent: withFallback(DEFAULT_THEME.accent, 'oklch(0.58 0.22 293)'),
  info: withFallback(DEFAULT_THEME.info, 'oklch(0.75 0.16 70)'),
  success: withFallback(DEFAULT_THEME.success, 'oklch(0.55 0.17 145)'),
  destructive: withFallback(DEFAULT_THEME.destructive, 'oklch(0.58 0.24 28)'),
};

const darkOverrides = DEFAULT_THEME.dark;

const darkSemanticColors: SemanticColorTokens = {
  background: withFallback(darkOverrides?.background, lightSemanticColors.background),
  foreground: withFallback(darkOverrides?.foreground, lightSemanticColors.foreground),
  accent: withFallback(darkOverrides?.accent, lightSemanticColors.accent),
  info: withFallback(darkOverrides?.info, lightSemanticColors.info),
  success: withFallback(darkOverrides?.success, lightSemanticColors.success),
  destructive: withFallback(darkOverrides?.destructive, lightSemanticColors.destructive),
};

export const semanticColors: Record<ColorMode, SemanticColorTokens> = {
  light: lightSemanticColors,
  dark: darkSemanticColors,
};

const lightSurfaceColors: SurfaceColorTokens = {
  paper: withFallback(DEFAULT_THEME.paper, semanticColors.light.background),
  navigator: withFallback(DEFAULT_THEME.navigator, semanticColors.light.background),
  input: withFallback(DEFAULT_THEME.input, semanticColors.light.background),
  popover: withFallback(DEFAULT_THEME.popover, semanticColors.light.background),
  popoverSolid: withFallback(
    DEFAULT_THEME.popoverSolid,
    withFallback(DEFAULT_THEME.popover, semanticColors.light.background)
  ),
};

const darkSurfaceColors: SurfaceColorTokens = {
  paper: withFallback(
    darkOverrides?.paper ?? DEFAULT_THEME.paper,
    semanticColors.dark.background
  ),
  navigator: withFallback(
    darkOverrides?.navigator ?? DEFAULT_THEME.navigator,
    semanticColors.dark.background
  ),
  input: withFallback(
    darkOverrides?.input ?? DEFAULT_THEME.input,
    semanticColors.dark.background
  ),
  popover: withFallback(
    darkOverrides?.popover ?? DEFAULT_THEME.popover,
    semanticColors.dark.background
  ),
  popoverSolid: withFallback(
    darkOverrides?.popoverSolid ?? DEFAULT_THEME.popoverSolid,
    withFallback(
      darkOverrides?.popover ?? DEFAULT_THEME.popover,
      semanticColors.dark.background
    )
  ),
};

export const surfaceColors: Record<ColorMode, SurfaceColorTokens> = {
  light: lightSurfaceColors,
  dark: darkSurfaceColors,
};

export const colors = {
  light: {
    ...semanticColors.light,
    ...surfaceColors.light,
  },
  dark: {
    ...semanticColors.dark,
    ...surfaceColors.dark,
  },
} as const;

const BASE_FONT_SIZE = 15;
const SPACING_UNIT = 4;
const BASE_RADIUS = 0;

export const typography = {
  fontFamily: {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  fontSize: {
    xs: 12,
    sm: 13,
    base: BASE_FONT_SIZE,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
  },
  body: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: BASE_FONT_SIZE,
    fontWeight: '400',
    lineHeight: 22,
  },
  heading: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  mono: {
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 20,
  },
} as const;

export const spacing = {
  xxs: SPACING_UNIT / 2,
  xs: SPACING_UNIT,
  sm: SPACING_UNIT * 2,
  md: SPACING_UNIT * 3,
  lg: SPACING_UNIT * 4,
  xl: SPACING_UNIT * 6,
  '2xl': SPACING_UNIT * 8,
  '3xl': SPACING_UNIT * 12,
} as const;

export const radius = {
  none: BASE_RADIUS,
  sm: BASE_RADIUS,
  md: BASE_RADIUS,
  lg: BASE_RADIUS,
  xl: BASE_RADIUS,
} as const;

export const mobileTokens = {
  semanticColors,
  surfaceColors,
  colors,
  typography,
  spacing,
  radius,
} as const;

export type MobileTokens = typeof mobileTokens;

export default mobileTokens;
