import assert from 'node:assert/strict';
import test from 'node:test';
import { check, checkInputValue, parseElements, resolve, screen, settle, state, waitFor } from '../dist/core.js';

const element = (label, value, id = 'title', y = 20) =>
  `@e1 TextField label=${JSON.stringify(label)}${value === undefined ? '' : ` value=${JSON.stringify(value)}`} id="${id}" at=10,${y} size=200x40`;

function mockScreen(t, read) {
  const original = { mobileP: state.mobileP, deviceId: state.deviceId };
  state.deviceId = 'offline-fixture';
  state.mobileP = Promise.resolve({ callTool: async () => read() });
  t.after(() => Object.assign(state, original));
}
const output = (text) => ({ content: [{ type: 'text', text }] });

test('absence requires a valid selector; a moved or unknown ref is not absence', () => {
  const before = parseElements(element('제목', '', 'title', 20));
  state.lastRefs = new Map(before.map(e => [e.ref, e]));
  const moved = parseElements(element('제목', '', 'title', 200));
  for (const sel of [{}, { text: '  ' }, { ref: 'r999' }, { ref: before[0].ref }, { id: 'title', index: 20 }, { id: 'title', index: -1 }, { id: 'title', index: 0.5 }]) {
    const result = check(moved, { sel, state: 'absent' });
    assert.equal(result.pass, false, JSON.stringify(sel));
    assert.ok(result.code);
  }
  assert.equal(check([], { sel: { id: 'title' }, state: 'absent' }).pass, true);
  assert.equal(check([], { sel: { ref: before[0].ref }, state: 'absent' }).code, 'STALE_REF');
  assert.equal(check(moved, { sel: { id: 'title' }, state: 'present' }).pass, true);
});

test('presence allows multiple matches; enabled/disabled requires disambiguation', () => {
  const els = parseElements('@e1 Button label="저장" at=0,0 size=40x40\n@e2 Button label="저장" at=0,100 size=40x40 disabled');
  assert.equal(check(els, { sel: { text: '저장' }, state: 'present' }).pass, true);
  assert.equal(check(els, { sel: { text: '저장' }, state: 'absent' }).pass, false);
  for (const condition of ['enabled', 'disabled']) {
    assert.equal(check(els, { sel: { text: '저장' }, state: condition }).code, 'AMBIGUOUS_SELECTOR');
  }
  assert.equal(check(els, { sel: { text: '저장', index: 1 }, state: 'disabled' }).pass, true);
  assert.equal(resolve(els, { text: '저장', index: 0.5 }).code, 'INVALID_SELECTOR');
});

test('invalid selectors stop condition polling instead of consuming the timeout', async (t) => {
  let reads = 0;
  mockScreen(t, () => { reads++; return output(element('제목', '')); });
  const result = await waitFor({ sel: {}, state: 'absent' }, 1000, 1);
  assert.equal(result.pass, false);
  assert.equal(result.code, 'INVALID_SELECTOR');
  assert.equal(reads, 1);
});

test('input verification checks the original field, not matching text elsewhere', () => {
  const target = parseElements(element('제목', ''))[0];
  const screen = parseElements(`${element('제목', '')}\n${element('다른 입력칸', 'QA 테스트', 'other', 100)}\n@e3 StaticText label="QA 테스트" at=0,200 size=80x20`);
  assert.equal(checkInputValue(screen, target, 'QA 테스트').pass, false);
  assert.equal(checkInputValue(screen, target, 'QA 테스트').code, 'INPUT_VALUE_MISMATCH');
  assert.equal(checkInputValue(parseElements(element('제목', 'QA 테스트', 'title', 300)), target, 'QA 테스트').pass, true);
  assert.equal(checkInputValue(parseElements(element('제목', 'QA 테스트 추가')), target, 'QA 테스트').pass, false);
});

test('empty values, hidden values, and escaped Korean strings are handled distinctly', () => {
  const target = parseElements(element('제목', ''))[0];
  assert.equal(checkInputValue(parseElements(element('제목', '')), target, '').pass, true);
  assert.equal(checkInputValue(parseElements(element('제목', undefined)), target, '').code, 'INPUT_VALUE_UNAVAILABLE');
  const text = '한글 "인용"\n다음 줄\\경로';
  const changed = parseElements(element('제목', text));
  assert.equal(changed[0].value, text);
  assert.equal(checkInputValue(changed, target, text).pass, true);
});

test('input identity is conservative without an id or with duplicate ids', () => {
  const target = parseElements(element('제목', '', ''))[0];
  assert.equal(checkInputValue(parseElements(element('제목', '새 값', '')), target, '새 값').pass, true);
  assert.equal(checkInputValue(parseElements(element('다른 입력칸', '새 값', '')), target, '새 값').pass, false);
  assert.equal(checkInputValue(parseElements(element('제목', '새 값', '', 200)), target, '새 값').code, 'INPUT_TARGET_UNRESOLVED');
  const withId = parseElements(element('제목', ''))[0];
  const duplicate = parseElements(`${element('제목', '새 값')}\n${element('다른 입력칸', '새 값', 'title', 200)}`);
  assert.equal(checkInputValue(duplicate, withId, '새 값').pass, false);
});

test('screen read errors cannot become successful absence checks', async (t) => {
  mockScreen(t, () => ({ isError: true, ...output('Device disconnected') }));
  await assert.rejects(screen(), /SCREEN_READ_FAILED/);
  await assert.rejects(waitFor({ sel: { text: '로딩' }, state: 'absent' }, 100), /SCREEN_READ_FAILED/);
});

test('settle reports stability only after two matching reads', async (t) => {
  let reads = 0;
  mockScreen(t, () => { reads++; return output(element('제목', '한국어')); });
  const result = await settle(0, 500, 1);
  assert.equal(result.stable, true);
  assert.equal(result.timedOut, false);
  assert.ok(reads >= 2);
});

test('settle reports timeout while the screen continues changing, including beyond summary limits', async (t) => {
  let reads = 0;
  const prefix = Array.from({ length: 201 }, (_, i) => `@e${i} StaticText label="고정 ${i}" at=0,${i * 20} size=80x10`).join('\n');
  mockScreen(t, () => output(`${prefix}\n@tail StaticText label="변경 ${++reads}" at=0,5000 size=80x10`));
  const result = await settle(0, 80, 1);
  assert.equal(result.stable, false);
  assert.equal(result.timedOut, true);
  assert.ok(reads >= 2);
});

test('a single read at the deadline cannot prove stability', async (t) => {
  mockScreen(t, () => output(element('제목', '')));
  const result = await settle(0, 0, 1);
  assert.equal(result.stable, false);
  assert.equal(result.timedOut, true);
});
