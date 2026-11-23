import { describe, expect, it } from 'vitest';
import tokensCss from './tokens.css?raw';

type Palette = Readonly<Record<string, string>>;

function parseVariables(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of block.matchAll(/(--color-[a-z-]+):\s*(#[0-9a-f]{6})/gi)) {
    const [, name, value] = match;
    if (name && value) result[name] = value;
  }
  return result;
}

const darkStart = tokensCss.indexOf('prefers-color-scheme: dark');
const light = parseVariables(tokensCss.slice(0, darkStart));
const dark = { ...light, ...parseVariables(tokensCss.slice(darkStart)) };

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function pair(palette: Palette, fg: string, bg: string): number {
  const foreground = palette[fg];
  const background = palette[bg];
  if (!foreground || !background) throw new Error(`Missing token ${fg} or ${bg}`);
  return ratio(foreground, background);
}

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast (WCAG AA)', (_name, palette) => {
  it.each([
    ['--color-text', '--color-bg'],
    ['--color-text', '--color-surface'],
    ['--color-text-muted', '--color-bg'],
    ['--color-text-muted', '--color-surface-alt'],
    ['--color-primary', '--color-bg'],
    ['--color-on-primary', '--color-primary'],
    ['--color-on-primary', '--color-primary-hover'],
    ['--color-success', '--color-success-bg'],
    ['--color-error', '--color-error-bg'],
    ['--color-info', '--color-info-bg'],
    ['--color-warning', '--color-warning-bg'],
  ])('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(pair(palette, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['--color-border', '--color-bg'],
    ['--color-border', '--color-surface'],
    ['--color-focus', '--color-bg'],
    ['--color-focus', '--color-surface-alt'],
  ])('UI colour %s on %s is at least 3:1', (fg, bg) => {
    expect(pair(palette, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
