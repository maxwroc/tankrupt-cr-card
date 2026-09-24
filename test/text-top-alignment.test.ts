import { describe, expect, it } from 'vitest';
import { textInkOffset } from '../src/custom-elements/text-top-alignment';

describe('glyph top alignment', () => {
  it('uses font ascent and visible ink instead of equating element tops', () => {
    const metrics = {
      fontBoundingBoxAscent: 38,
      fontBoundingBoxDescent: 10,
      actualBoundingBoxAscent: 30,
    } as TextMetrics;
    expect(textInkOffset(metrics, 42)).toBe(5);
    expect(
      textInkOffset(
        {
          ...metrics,
          fontBoundingBoxAscent: 12,
          fontBoundingBoxDescent: 3,
          actualBoundingBoxAscent: 10,
        },
        14,
      ),
    ).toBe(1.5);
  });
});
