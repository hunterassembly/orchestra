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

const HEX_COLOR_RE = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const FUNCTION_COLOR_RE = /^(?:rgb|hsl)a?\(/i;
const NAMED_COLOR_RE = /^[a-z]+$/i;
const OKLCH_COLOR_RE =
  /^oklch\(\s*([+-]?\d*\.?\d+%?)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)(?:\s*\/\s*([+-]?\d*\.?\d+%?))?\s*\)$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseFraction(value: string): number | null {
  const trimmed = value.trim();
  const isPercent = trimmed.endsWith('%');
  const parsed = Number.parseFloat(isPercent ? trimmed.slice(0, -1) : trimmed);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isPercent ? parsed / 100 : parsed;
}

function linearToSrgb(channel: number): number {
  const clamped = clamp(channel, 0, 1);
  if (clamped <= 0.0031308) {
    return 12.92 * clamped;
  }

  return 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function toHexByte(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function oklchToReactNativeColor(value: string): string | null {
  const match = value.match(OKLCH_COLOR_RE);
  if (!match) {
    return null;
  }

  const lightness = parseFraction(match[1]!);
  const chroma = Number.parseFloat(match[2]!);
  const hue = Number.parseFloat(match[3]!);
  const alpha = match[4] ? parseFraction(match[4]) : 1;

  if (
    lightness == null ||
    alpha == null ||
    !Number.isFinite(chroma) ||
    !Number.isFinite(hue)
  ) {
    return null;
  }

  const hueRadians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(hueRadians);
  const b = chroma * Math.sin(hueRadians);

  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLinear = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLinear = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLinear = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const red = Math.round(linearToSrgb(rLinear) * 255);
  const green = Math.round(linearToSrgb(gLinear) * 255);
  const blue = Math.round(linearToSrgb(bLinear) * 255);
  const normalizedAlpha = clamp(alpha, 0, 1);

  if (normalizedAlpha >= 1) {
    return `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
  }

  return `rgba(${red}, ${green}, ${blue}, ${Math.round(normalizedAlpha * 1000) / 1000})`;
}

export function toReactNativeColor(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (HEX_COLOR_RE.test(trimmed) || FUNCTION_COLOR_RE.test(trimmed) || NAMED_COLOR_RE.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.toLowerCase().startsWith('oklch(')) {
    return oklchToReactNativeColor(trimmed);
  }

  return null;
}

function resolveColor(value: string | undefined, fallback: string): string {
  return toReactNativeColor(value) ?? fallback;
}

const lightSemanticColors: SemanticColorTokens = {
  background: resolveColor(DEFAULT_THEME.background, '#f7f8fa'),
  foreground: resolveColor(DEFAULT_THEME.foreground, '#111317'),
  accent: resolveColor(DEFAULT_THEME.accent, '#8453ed'),
  info: resolveColor(DEFAULT_THEME.info, '#ed990e'),
  success: resolveColor(DEFAULT_THEME.success, '#098926'),
  destructive: resolveColor(DEFAULT_THEME.destructive, '#e6000c'),
};

const darkOverrides = DEFAULT_THEME.dark;

const darkSemanticColors: SemanticColorTokens = {
  background: resolveColor(darkOverrides?.background, lightSemanticColors.background),
  foreground: resolveColor(darkOverrides?.foreground, lightSemanticColors.foreground),
  accent: resolveColor(darkOverrides?.accent, lightSemanticColors.accent),
  info: resolveColor(darkOverrides?.info, lightSemanticColors.info),
  success: resolveColor(darkOverrides?.success, lightSemanticColors.success),
  destructive: resolveColor(darkOverrides?.destructive, lightSemanticColors.destructive),
};

export const semanticColors: Record<ColorMode, SemanticColorTokens> = {
  light: lightSemanticColors,
  dark: darkSemanticColors,
};

const lightSurfaceColors: SurfaceColorTokens = {
  paper: resolveColor(DEFAULT_THEME.paper, semanticColors.light.background),
  navigator: resolveColor(DEFAULT_THEME.navigator, semanticColors.light.background),
  input: resolveColor(DEFAULT_THEME.input, semanticColors.light.background),
  popover: resolveColor(DEFAULT_THEME.popover, semanticColors.light.background),
  popoverSolid: resolveColor(
    DEFAULT_THEME.popoverSolid,
    resolveColor(DEFAULT_THEME.popover, semanticColors.light.background)
  ),
};

const darkSurfaceColors: SurfaceColorTokens = {
  paper: resolveColor(
    darkOverrides?.paper ?? DEFAULT_THEME.paper,
    semanticColors.dark.background
  ),
  navigator: resolveColor(
    darkOverrides?.navigator ?? DEFAULT_THEME.navigator,
    semanticColors.dark.background
  ),
  input: resolveColor(
    darkOverrides?.input ?? DEFAULT_THEME.input,
    semanticColors.dark.background
  ),
  popover: resolveColor(
    darkOverrides?.popover ?? DEFAULT_THEME.popover,
    semanticColors.dark.background
  ),
  popoverSolid: resolveColor(
    darkOverrides?.popoverSolid ?? DEFAULT_THEME.popoverSolid,
    resolveColor(
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
    sans: 'System',
    mono: 'Courier',
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
    fontFamily: 'System',
    fontSize: BASE_FONT_SIZE,
    fontWeight: '400',
    lineHeight: 22,
  },
  heading: {
    fontFamily: 'System',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  mono: {
    fontFamily: 'Courier',
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
