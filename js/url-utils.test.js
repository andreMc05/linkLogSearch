import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLineToRecord,
  dedupeTags,
  parseFilterQuery,
  rowMatchesFilter,
  textContentGroupKey,
} from './url-utils.js';

test('parseLineToRecord: bare domain with dot → URL', () => {
  const r = parseLineToRecord('example.com/path');
  assert.equal(r.type, 'url');
  if (r.type === 'url') {
    assert.match(r.url, /^https:\/\/example\.com\/path/);
    assert.equal(r.domain, 'example.com');
  }
});

test('parseLineToRecord: explicit https:// → URL', () => {
  const r = parseLineToRecord('https://github.com/user/repo');
  assert.equal(r.type, 'url');
});

test('parseLineToRecord: plain phrase → text', () => {
  const r = parseLineToRecord('hello world');
  assert.equal(r.type, 'text');
  if (r.type === 'text') assert.equal(r.content, 'hello world');
});

test('parseLineToRecord: bare username (no dot) → text', () => {
  assert.equal(parseLineToRecord('ariadna_cooper').type, 'text');
  assert.equal(parseLineToRecord('Miss_Dxxx').type, 'text');
  assert.equal(parseLineToRecord('nicollesofia2').type, 'text');
  assert.equal(parseLineToRecord('Barbie_Teddy').type, 'text');
});

test('parseLineToRecord: non-http scheme → text', () => {
  assert.equal(parseLineToRecord('mailto:a@b.com').type, 'text');
  assert.equal(parseLineToRecord('ftp://files.example.com').type, 'text');
});

test('dedupeTags is case-insensitive', () => {
  assert.deepEqual(dedupeTags(['Foo', 'foo', ' Bar ']), ['Foo', 'Bar']);
});

test('filter tag prefix matches substring', () => {
  const p = parseFilterQuery('tag:read');
  assert.equal(p.mode, 'tag');
  assert.equal(rowMatchesFilter(p, { tags: ['reading', 'x'] }, null), true);
  assert.equal(rowMatchesFilter(p, { tags: ['other'] }, null), false);
});

test('parseLineToRecord: http → upgraded to https', () => {
  const r = parseLineToRecord('http://example.com/page');
  assert.equal(r.type, 'url');
  if (r.type === 'url') assert.match(r.url, /^https:/);
});

test('parseLineToRecord: www. stripped from stored url and domain', () => {
  const r = parseLineToRecord('https://www.example.com/page');
  assert.equal(r.type, 'url');
  if (r.type === 'url') {
    assert.doesNotMatch(r.url, /\/\/www\./);
    assert.doesNotMatch(r.domain, /^www\./);
  }
});

test('parseLineToRecord: utm_* query params stripped', () => {
  const r = parseLineToRecord('https://example.com/?utm_source=email&id=42');
  assert.equal(r.type, 'url');
  if (r.type === 'url') {
    assert.doesNotMatch(r.url, /utm_/);
    assert.match(r.url, /id=42/);
  }
});

test('parseLineToRecord: double semicolons stripped from URL path', () => {
  const r = parseLineToRecord('https://example.com/page;;jsessionid=abc');
  assert.equal(r.type, 'url');
  if (r.type === 'url') assert.doesNotMatch(r.url, /;;/);
});

test('parseLineToRecord: double semicolons stripped from bare domain URL', () => {
  const r = parseLineToRecord('example.com/page;;session=xyz');
  assert.equal(r.type, 'url');
  if (r.type === 'url') assert.doesNotMatch(r.url, /;;/);
});

test('parseLineToRecord: double semicolons stripped from text content', () => {
  const r = parseLineToRecord('some note;; extra');
  assert.equal(r.type, 'text');
  if (r.type === 'text') assert.doesNotMatch(r.content, /;;/);
});

test('parseLineToRecord: bare "\\" is treated as empty', () => {
  assert.equal(parseLineToRecord('\\').type, 'empty');
  assert.equal(parseLineToRecord('  \\  ').type, 'empty');
});

test('parseLineToRecord: trailing backslash stripped from text content', () => {
  const r = parseLineToRecord('some note\\');
  assert.equal(r.type, 'text');
  if (r.type === 'text') assert.doesNotMatch(r.content, /\\$/);
});

test('parseLineToRecord: originalLine preserved before normalization', () => {
  const line = 'http://www.example.com/?utm_source=email';
  const r = parseLineToRecord(line);
  assert.equal(r.type, 'url');
  if (r.type === 'url') assert.equal(r.originalLine, line);
});

test('textContentGroupKey is stable', () => {
  const a = textContentGroupKey('hello');
  const b = textContentGroupKey('hello');
  const c = textContentGroupKey('hellp');
  assert.equal(a, b);
  assert.notEqual(a, c);
});
