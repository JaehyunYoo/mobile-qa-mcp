import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG, crashesSince, state } from '../dist/core.js';
import { activeRun, endRun, logStep, startRun } from '../dist/runlog.js';

test('reports use the selected language and preserve Korean evidence and counts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-report-test-'));
  const original = { mobileP: state.mobileP, deviceId: state.deviceId };
  const originalLanguage = CONFIG.reportLanguage;
  state.deviceId = 'test-device';
  state.mobileP = Promise.resolve({ callTool: async () => ({ content: [{ type: 'text', text: '{"devices":[]}' }] }) });
  t.after(() => {
    if (activeRun()) endRun();
    Object.assign(state, original);
    if (originalLanguage === undefined) delete CONFIG.reportLanguage; else CONFIG.reportLanguage = originalLanguage;
    rmSync(dir, { recursive: true, force: true });
  });
  const titles = { en: 'QA Run Results', ko: 'QA 실행 결과', ja: 'QA実行結果' };
  for (const reportLanguage of ['en', 'ko', 'ja']) {
    const run = await startRun(`언어-${reportLanguage}`, { dir, reportLanguage, scenario: 'qa/일정.md' });
    logStep({ tool: 'qa_step', title: '제목 입력', expected: 'QA 테스트', actual: 'QA 테스트', result: 'pass', ms: 10 });
    logStep({ tool: 'qa_step', title: '저장 버튼 확인', result: 'fail', ms: 20 });
    logStep({ tool: 'qa_step', title: '다음 화면', result: 'skip', ms: 0 });
    logStep({ tool: 'qa_expect', result: 'fail', ms: 5 });
    logStep({ tool: 'wait', result: 'fail', ms: 8000, expected: 'present 제목', actual: '없음' });
    logStep({ tool: 'qa_tap', result: 'fail', ms: 9000, actual: '탭: r1 "추가"' });
    logStep({ tool: 'qa_expect', result: 'fail', ms: 2000, actual: 'FAIL present "정보" — 없음 (2000ms)' });
    const result = endRun('한국어 요약 유지');
    assert.equal(result.pass, 1);
    assert.equal(result.fail, 2, 'a qa_expect FAIL is an assertion failure, not a tool error');
    assert.equal(result.skip, 1);
    assert.equal(result.toolFails, 1);
    assert.equal(result.notFounds, 1, 'wait+tap pair is one element-not-found row, not a tool error');
    const report = readFileSync(join(run.dir, 'report.md'), 'utf8');
    assert.ok(report.startsWith(`# ${titles[reportLanguage]} — 언어-${reportLanguage}`));
    assert.ok(report.includes('제목 입력'));
    assert.ok(report.includes('QA 테스트'));
    assert.ok(report.includes('한국어 요약 유지'));
    assert.ok(report.includes('\n\n## '));
    assert.equal(report.match(/\| 🔍 /g).length, 1);
    assert.ok(report.includes('qa_tap → wait'));
    assert.ok(!report.includes('탭:') && !report.includes('present 제목'), 'tool log text is rewritten in the report language');
    assert.ok(report.includes({ en: 'The action on "추가" went through', ko: '"추가" 조작까지는', ja: '「추가」の操作までは' }[reportLanguage]));
    assert.ok(report.includes({ en: '"제목" is shown', ko: '"제목" 이(가) 화면에 보입니다', ja: '「제목」が表示される' }[reportLanguage]));
    assert.ok(report.includes({ en: '"정보" is shown', ko: '"정보" 이(가) 화면에 보입니다', ja: '「정보」が表示される' }[reportLanguage]));
    assert.match(report, /\| ❌ FAIL \| qa_expect \| .+ \| 없음 \|/);
    assert.ok(report.includes({ en: 'Response size:', ko: '응답 크기:', ja: '応答サイズ:' }[reportLanguage]));
    assert.equal(JSON.parse(readFileSync(join(run.dir, 'meta.json'), 'utf8')).reportLanguage, reportLanguage);
  }
  CONFIG.reportLanguage = 'ja';
  assert.equal((await startRun('from-config', { dir })).reportLanguage, 'ja');
  endRun();
  assert.equal((await startRun('override', { dir, reportLanguage: 'ko' })).reportLanguage, 'ko');
  endRun();
  delete CONFIG.reportLanguage;
  assert.equal((await startRun('default', { dir })).reportLanguage, 'en');
  endRun();
  const before = readdirSync(dir);
  CONFIG.reportLanguage = 'unsupported';
  await assert.rejects(startRun('invalid', { dir }), /reportLanguage must be en, ko, or ja/);
  assert.equal(activeRun(), undefined);
  assert.deepEqual(readdirSync(dir), before, 'invalid language must not create run files');
});

test('crash list keeps only crashes since the session started', () => {
  const since = new Date('2026-10-01T11:00:00').getTime();
  const raw = JSON.stringify([
    { processName: 'Old', timestamp: '2026-09-06 17:23:41', id: 'old.ips' },
    { processName: 'Runner', timestamp: '2026-10-01 11:05:00', id: 'new.ips' },
    { processName: 'NoTime', id: 'unknown.ips' },
  ]);
  const out = crashesSince(raw, since);
  assert.ok(out.includes('new.ips') && out.includes('unknown.ips') && !out.includes('old.ips'));
  assert.match(crashesSince(JSON.stringify([{ timestamp: '2026-09-06 17:23:41' }]), since), /없음 \(이전 기록 1건 제외\)/);
  assert.equal(crashesSince('not json', since), 'not json');
});
