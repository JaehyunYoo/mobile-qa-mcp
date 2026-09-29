import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function withServer(mode, fn) {
  const client = new Client({ name: 'offline-tests', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mock-server.mjs', import.meta.url)), mode], stderr: 'pipe' });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close();
  }
}
const textOf = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

test('MCP qa_expect rejects stale refs and missing selectors without reporting PASS', async () => {
  await withServer('stale-ref', async client => {
    for (const args of [{ ref: 'r1', state: 'absent' }, { state: 'absent' }]) {
      const result = await client.callTool({ name: 'qa_expect', arguments: args });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /STALE_REF|INVALID_SELECTOR/);
    }
    const absent = await client.callTool({ name: 'qa_expect', arguments: { id: 'missing', state: 'absent' } });
    assert.notEqual(absent.isError, true);
    assert.match(textOf(absent), /^PASS/);
  });
});

test('MCP screen errors fail absence checks', async () => {
  await withServer('screen-error', async client => {
    const result = await client.callTool({ name: 'qa_expect', arguments: { text: '로딩', state: 'absent' } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /SCREEN_READ_FAILED/);
  });
});

test('MCP qa_type rejects matching text elsewhere and verifies the selected field', async () => {
  for (const [mode, shouldFail] of [['input-unrelated', true], ['input-ok', false]]) {
    await withServer(mode, async client => {
      const result = await client.callTool({ name: 'qa_type', arguments: { id: 'title', text: 'QA 테스트', timeoutMs: 0 } });
      assert.equal(result.isError === true, shouldFail);
      if (shouldFail) assert.match(textOf(result), /INPUT_VALUE_MISMATCH/);
      else assert.match(textOf(result), /QA 테스트/);
    });
  }
});

test('MCP input operation errors remain failures', async () => {
  for (const mode of ['focus-error', 'input-error', 'dart-error']) {
    await withServer(mode, async client => {
      const result = await client.callTool({ name: 'qa_type', arguments: { id: 'title', text: '', timeoutMs: 0 } });
      assert.equal(result.isError, true, mode);
      assert.match(textOf(result), /INPUT_FOCUS_FAILED|INPUT_FAILED|DRIVER_FAILED/);
    });
  }
});

test('MCP stability timeouts propagate through wait, tap, and launch', async () => {
  await withServer('changing', async client => {
    for (const [name, args] of [
      ['qa_wait_until', { stable: true, timeoutMs: 700 }],
      ['qa_tap_xy', { x: 10, y: 10, timeoutMs: 0 }],
      ['qa_launch', { packageName: 'com.example.test', timeoutMs: 0 }],
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, name);
      assert.match(textOf(result), /WAIT_TIMEOUT/);
    }
  });
  await withServer('still', async client => {
    const result = await client.callTool({ name: 'qa_wait_until', arguments: { stable: true, timeoutMs: 1500 } });
    assert.notEqual(result.isError, true);
    assert.match(textOf(result), /Screen stable/);
  });
});

test('MCP accepts report languages in tools and prompts and writes the selected report language', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-mcp-report-'));
  try {
    await withServer('still', async client => {
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 18);
      const startTool = tools.tools.find(t => t.name === 'qa_run_start');
      assert.deepEqual(startTool.inputSchema.properties.reportLanguage.enum, ['en', 'ko', 'ja']);
      for (const language of ['en', 'ko', 'ja']) {
        for (const [name, args] of [
          ['run_qa', { scenario: 'qa/일정.md' }],
          ['explore_qa', { area: '마이 탭' }],
          ['report_qa', { scenarios: 'qa/runs' }],
        ]) {
          const result = await client.getPrompt({ name, arguments: { ...args, reportLanguage: language } });
          assert.equal(result.messages.length, 1);
          assert.ok(result.messages[0].content.text.includes(Object.values(args)[0]));
        }
      }
      await assert.rejects(client.getPrompt({ name: 'run_qa', arguments: { scenario: 'test.md', reportLanguage: 'invalid' } }));
      const invalid = await client.callTool({ name: 'qa_run_start', arguments: { name: 'invalid', dir, reportLanguage: 'invalid' } });
      assert.equal(invalid.isError, true);
      const started = await client.callTool({ name: 'qa_run_start', arguments: { name: 'tool-test', dir, reportLanguage: 'ja' } });
      assert.notEqual(started.isError, true);
      await client.callTool({ name: 'qa_step', arguments: { title: '한국어 유지', expected: '저장', actual: '저장', result: 'pass' } });
      const ended = await client.callTool({ name: 'qa_run_end', arguments: { summary: '요약 원문' } });
      const reportPath = textOf(ended).split('\n').at(-1).replace(/^보고서: /, '');
      const report = readFileSync(reportPath, 'utf8');
      assert.match(report, /^# QA実行結果/);
      assert.ok(report.includes('한국어 유지'));
      assert.ok(report.includes('요약 원문'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
