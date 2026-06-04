import { describe, expect, it } from 'vitest';

import { csvCell } from './shared';

describe('csvCell', () => {
  it('quotes CSV syntax characters', () => {
    expect(csvCell('ok,value')).toBe('"ok,value"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('neutralizes spreadsheet formula prefixes', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(csvCell('  =1+1')).toBe("'  =1+1");
  });
});
