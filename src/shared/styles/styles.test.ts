import { describe, expect, it } from 'vitest';
import globalCss from './global.css?raw';
import tokensCss from './tokens.css?raw';

const css = import.meta.glob<string>('../../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const EXPECTED_TOKENS = [
  '--color-bg',
  '--color-surface',
  '--color-surface-alt',
  '--color-text',
  '--color-text-muted',
  '--color-border',
  '--color-border-subtle',
  '--color-primary',
  '--color-primary-hover',
  '--color-on-primary',
  '--color-focus',
  '--color-success',
  '--color-success-bg',
  '--color-error',
  '--color-error-bg',
  '--color-info',
  '--color-info-bg',
  '--color-warning',
  '--color-warning-bg',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-6',
  '--space-8',
  '--space-12',
  '--space-16',
  '--font-sans',
  '--text-sm',
  '--text-base',
  '--text-lg',
  '--text-xl',
  '--text-2xl',
  '--text-3xl',
  '--leading-body',
  '--leading-heading',
  '--weight-regular',
  '--weight-semibold',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--shadow-sm',
  '--border-width',
  '--tap-target',
  '--container-max',
  '--container-pad',
  '--duration-fast',
];

describe('design tokens', () => {
  it.each(EXPECTED_TOKENS)('defines %s', (token) => {
    expect(tokensCss).toContain(`${token}:`);
  });

  it('supports light and dark colour schemes', () => {
    expect(tokensCss).toContain('color-scheme: light dark');
    expect(tokensCss).toContain('@media (prefers-color-scheme: dark)');
  });

  it('uses no raw hex colours outside tokens.css', () => {
    expect(Object.keys(css).length).toBeGreaterThan(5);
    const offenders = Object.entries(css)
      .filter(([path]) => !path.endsWith('tokens.css'))
      .filter(([, content]) => /#[0-9a-f]{3,8}\b/i.test(content))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe('global styles', () => {
  it('has a 3px focus ring with offset', () => {
    expect(globalCss).toMatch(/:focus-visible\s*{[^}]*outline:\s*3px solid var\(--color-focus\)/);
    expect(globalCss).toContain('outline-offset: 2px');
  });

  it('disables motion for reduced-motion users', () => {
    expect(globalCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globalCss).toContain('animation: none');
    expect(globalCss).toContain('transition: none');
  });
});
