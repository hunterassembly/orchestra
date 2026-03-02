import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { DEFAULT_THEME } from '../../shared/src/config/theme.ts';
import { colors, mobileTokens, radius, semanticColors, spacing, surfaceColors, typography } from './index';

const UI_CSS_SOURCE = readFileSync(new URL('../../ui/src/styles/index.css', import.meta.url), 'utf8');

const ROOT_BLOCK_MATCH = UI_CSS_SOURCE.match(/:root\s*\{([\s\S]*?)\n\}/);
const ROOT_BLOCK = ROOT_BLOCK_MATCH?.[1] ?? '';

const SEMANTIC_KEYS = ['background', 'foreground', 'accent', 'info', 'success', 'destructive'] as const;
const SURFACE_KEYS = ['paper', 'navigator', 'input', 'popover', 'popoverSolid'] as const;

function getCssVariable(cssVarName: string): string {
  const escapedName = cssVarName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = ROOT_BLOCK.match(new RegExp(`${escapedName}:\\s*([^;]+);`));

  if (!match?.[1]) {
    throw new Error(`Missing CSS variable ${cssVarName}`);
  }

  return match[1].trim();
}

function toPixels(lengthValue: string): number {
  if (lengthValue.endsWith('px')) {
    return Number.parseFloat(lengthValue.replace('px', ''));
  }

  if (lengthValue.endsWith('rem')) {
    return Number.parseFloat(lengthValue.replace('rem', '')) * 16;
  }

  throw new Error(`Unsupported CSS length for token extraction: ${lengthValue}`);
}

describe('mobile-tokens color parity', () => {
  it('exports complete semantic and surface tokens for light and dark modes', () => {
    expect(Object.keys(semanticColors.light).sort()).toEqual([...SEMANTIC_KEYS].sort());
    expect(Object.keys(semanticColors.dark).sort()).toEqual([...SEMANTIC_KEYS].sort());

    expect(Object.keys(surfaceColors.light).sort()).toEqual([...SURFACE_KEYS].sort());
    expect(Object.keys(surfaceColors.dark).sort()).toEqual([...SURFACE_KEYS].sort());
  });

  it('matches DEFAULT_THEME semantic colors for light and dark', () => {
    for (const key of SEMANTIC_KEYS) {
      const lightValue = DEFAULT_THEME[key] ?? semanticColors.light[key];
      const darkValue = DEFAULT_THEME.dark?.[key] ?? lightValue;

      expect(semanticColors.light[key]).toEqual(lightValue);
      expect(semanticColors.dark[key]).toEqual(darkValue);
    }
  });

  it('matches DEFAULT_THEME surface fallback behavior for light and dark', () => {
    for (const key of SURFACE_KEYS) {
      const lightValue = DEFAULT_THEME[key] ?? semanticColors.light.background;

      const darkValue =
        DEFAULT_THEME.dark?.[key] ??
        DEFAULT_THEME[key] ??
        semanticColors.dark.background;

      expect(surfaceColors.light[key]).toEqual(lightValue);
      expect(surfaceColors.dark[key]).toEqual(darkValue);
    }
  });

  it('exports combined color maps for direct mode access', () => {
    expect(colors.light).toMatchObject({
      ...semanticColors.light,
      ...surfaceColors.light,
    });

    expect(colors.dark).toMatchObject({
      ...semanticColors.dark,
      ...surfaceColors.dark,
    });
  });
});

describe('mobile-tokens typography, spacing, and radius parity', () => {
  it('matches typography defaults extracted from packages/ui styles', () => {
    expect(typography.fontFamily.sans as string).toEqual(getCssVariable('--font-sans'));
    expect(typography.fontFamily.mono as string).toEqual(getCssVariable('--font-mono'));

    const baseFontSizePx = toPixels(getCssVariable('--font-size-base'));
    expect(typography.fontSize.base as number).toEqual(baseFontSizePx);
  });

  it('exports body, heading, and mono text styles for React Native usage', () => {
    expect(typography.body).toMatchObject({
      fontFamily: typography.fontFamily.sans,
      fontSize: typography.fontSize.base,
      fontWeight: '400',
    });

    expect(typography.heading).toMatchObject({
      fontFamily: typography.fontFamily.sans,
      fontWeight: '700',
    });

    expect(typography.mono).toMatchObject({
      fontFamily: typography.fontFamily.mono,
      fontWeight: '400',
    });
  });

  it('exports spacing and radius scales from CSS base values', () => {
    const spacingBasePx = toPixels(getCssVariable('--spacing'));
    const radiusBasePx = toPixels(getCssVariable('--radius'));

    expect(spacing.xs as number).toEqual(spacingBasePx);
    expect(spacing.sm as number).toEqual(spacingBasePx * 2);
    expect(spacing.md as number).toEqual(spacingBasePx * 3);

    expect(radius.none as number).toEqual(radiusBasePx);
    expect(radius.sm as number).toEqual(radiusBasePx);
    expect(radius.md as number).toEqual(radiusBasePx);
    expect(radius.lg as number).toEqual(radiusBasePx);
    expect(radius.xl as number).toEqual(radiusBasePx);
  });
});

describe('mobile token bundle export', () => {
  it('provides a single mobileTokens object with all token categories', () => {
    expect(mobileTokens.semanticColors).toBe(semanticColors);
    expect(mobileTokens.surfaceColors).toBe(surfaceColors);
    expect(mobileTokens.colors).toBe(colors);
    expect(mobileTokens.typography).toBe(typography);
    expect(mobileTokens.spacing).toBe(spacing);
    expect(mobileTokens.radius).toBe(radius);
  });
});
