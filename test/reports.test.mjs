import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG, state } from '../dist/core.js';
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
    const result = endRun('한국어 요약 유지');
    assert.equal(result.pass, 1);
    assert.equal(result.fail, 1);
    assert.equal(result.skip, 1);
    assert.equal(result.toolFails, 1);
    const report = readFileSync(join(run.dir, 'report.md'), 'utf8');
    assert.ok(report.startsWith(`# ${titles[reportLanguage]} — 언어-${reportLanguage}`));
    assert.ok(report.includes('제목 입력'));
    assert.ok(report.includes('QA 테스트'));
    assert.ok(report.includes('한국어 요약 유지'));
    assert.ok(report.includes('\n\n## '));
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
