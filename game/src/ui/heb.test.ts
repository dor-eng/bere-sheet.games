// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prep } from './heb.ts';
import levels from '../data/levels.json' with { type: 'json' };

test('prep: ל/ב swallow the article, מ keeps it, a root ה stays (PT-1023 B-3)', () => {
  assert.equal(prep('ל', 'המועדון'), 'למועדון');
  assert.equal(prep('ב', 'הכיכר'), 'בכיכר');
  assert.equal(prep('מ', 'המחצבה'), 'מהמחצבה');
  assert.equal(prep('ל', 'היכל המופעים'), 'להיכל המופעים');
  assert.equal(prep('ל', 'חתונה'), 'לחתונה');
});

test('no site name in the levels yields a double article after ל/ב', () => {
  for (const l of levels) for (const s of l.sites) {
    const n = s.name.split(' - ')[0];
    for (const p of ['ל', 'ב']) assert.ok(!prep(p, n).startsWith(p + 'ה') || n.startsWith('היכל'), `${p}${n}`);
  }
});
