import { configureAxe } from 'vitest-axe';

/** Axe for jsdom: colour contrast needs real layout, so `contrast.test.ts` covers it instead. */
export const axe = configureAxe({
  rules: { 'color-contrast': { enabled: false } },
});

/** Throws with a readable report if `container` has detectable accessibility violations. */
export async function expectNoViolations(container: Element): Promise<void> {
  const { violations } = await axe(container);
  if (violations.length === 0) return;
  const report = violations
    .map(
      (v) =>
        `${v.help} (${v.id})\n` +
        v.nodes.map((n) => `  ${n.target.join(', ')}: ${n.html}`).join('\n'),
    )
    .join('\n\n');
  throw new Error(`Accessibility violations:\n${report}`);
}
