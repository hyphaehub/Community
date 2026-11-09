import { describe, expect, it } from 'vitest';
import {
  computeGenerations,
  cultureTypeForLibraryFormat,
  libraryFormatForCultureType,
  reviveByDate,
  reviveStatus,
  sourceTypeForLibraryFormat,
} from './genetics';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe('computeGenerations', () => {
  it('assigns 0 to roots and +1 per transfer down a chain', () => {
    const g = computeGenerations(
      ['a', 'b', 'c'],
      [
        { parentCultureId: 'a', childCultureId: 'b' },
        { parentCultureId: 'b', childCultureId: 'c' },
      ],
    );
    expect(g.get('a')).toBe(0);
    expect(g.get('b')).toBe(1);
    expect(g.get('c')).toBe(2);
  });

  it('takes the longest path at a merge (diamond)', () => {
    const g = computeGenerations(
      ['a', 'b', 'c', 'd'],
      [
        { parentCultureId: 'a', childCultureId: 'b' },
        { parentCultureId: 'a', childCultureId: 'c' },
        { parentCultureId: 'b', childCultureId: 'd' },
        { parentCultureId: 'c', childCultureId: 'd' },
      ],
    );
    expect(g.get('d')).toBe(2);
  });

  it('ignores edges to cultures outside the set', () => {
    const g = computeGenerations(['x'], [{ parentCultureId: 'ghost', childCultureId: 'x' }]);
    expect(g.get('x')).toBe(0);
  });
});

describe('reviveStatus', () => {
  it('flags an LC past its 60-day viability as overdue', () => {
    expect(reviveStatus('LIQUID_CULTURE', ago(90)).status).toBe('overdue');
  });
  it('keeps a fresh slant ok', () => {
    expect(reviveStatus('AGAR_SLANT', ago(10)).status).toBe('ok');
  });
  it('treats cryo as indefinite', () => {
    expect(reviveStatus('CRYO', ago(1000)).status).toBe('indefinite');
    expect(reviveByDate('CRYO', ago(1000))).toBeNull();
  });
  it('warns when within the due window', () => {
    // Agar plate viability 180d; stored 170d ago → 10d left → due.
    expect(reviveStatus('AGAR_PLATE', ago(170)).status).toBe('due');
  });
  it('uses lastRevivedAt over storedAt when present', () => {
    expect(reviveStatus('LIQUID_CULTURE', ago(90), ago(5)).status).toBe('ok');
  });
});

describe('library format → culture type mapping', () => {
  it('maps each format to the right culture type', () => {
    expect(cultureTypeForLibraryFormat('SPORE_SYRINGE')).toBe('SOURCE');
    expect(cultureTypeForLibraryFormat('SPORE_PRINT')).toBe('SOURCE');
    expect(cultureTypeForLibraryFormat('LIQUID_CULTURE')).toBe('LIQUID_CULTURE');
    expect(cultureTypeForLibraryFormat('AGAR_PLATE')).toBe('AGAR');
    expect(cultureTypeForLibraryFormat('AGAR_SLANT')).toBe('AGAR');
    expect(cultureTypeForLibraryFormat('CRYO')).toBe('AGAR');
    expect(cultureTypeForLibraryFormat('GRAIN')).toBe('GRAIN');
    expect(cultureTypeForLibraryFormat('OTHER')).toBe('SOURCE');
  });

  it('maps a source format to its origin kind, null for non-sources', () => {
    expect(sourceTypeForLibraryFormat('SPORE_SYRINGE')).toBe('SPORE_SYRINGE');
    expect(sourceTypeForLibraryFormat('AGAR_PLATE')).toBe('AGAR_CULTURE');
    expect(sourceTypeForLibraryFormat('GRAIN')).toBeNull();
  });

  it('derives a library format from a drawn culture type', () => {
    expect(libraryFormatForCultureType('LIQUID_CULTURE')).toBe('LIQUID_CULTURE');
    expect(libraryFormatForCultureType('AGAR')).toBe('AGAR_PLATE');
    expect(libraryFormatForCultureType('GRAIN')).toBe('GRAIN');
    expect(libraryFormatForCultureType('SOURCE')).toBe('OTHER');
  });
});
