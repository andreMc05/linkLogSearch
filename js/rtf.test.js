import test from 'node:test';
import assert from 'node:assert/strict';
import { rtfToPlainText } from './rtf.js';

test('rtfToPlainText extracts lines and strips controls', () => {
  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fswiss Helvetica;}}\f0\pard
first line\par
https://example.com\par
}`;
  const plain = rtfToPlainText(rtf);
  assert.match(plain, /first line/);
  assert.match(plain, /https:\/\/example\.com/);
});
