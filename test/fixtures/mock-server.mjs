// Offline MCP server fixture. No device processes are launched.
import { state, parseElements } from '../../dist/core.js';

const mode = process.argv[2] ?? 'still';
const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], isError });
let value = '';
let reads = 0;
const field = () => `@e1 TextField label="제목" value=${JSON.stringify(value)} id="title" at=10,20 size=200x40`;
state.deviceId = 'offline-device';
state.lastRefs = new Map(parseElements('@e1 Button label="삭제" id="delete_button" at=10,10 size=40x40').map(e => [e.ref, e]));
state.mobileP = Promise.resolve({
  callTool: async ({ name, arguments: args }) => {
    switch (name) {
      case 'mobile_list_available_devices': return textResult('{"devices":[]}');
      case 'mobile_list_elements_on_screen':
        reads++;
        if (mode === 'screen-error') return textResult('Device disconnected', true);
        if (mode === 'changing') return textResult(`@e1 StaticText label="로딩 ${reads}" at=0,0 size=100x40`);
        if (mode === 'stale-ref') return textResult('@e1 Button label="삭제" id="delete_button" at=10,200 size=40x40');
        return textResult(`${field()}\n@e2 StaticText label="QA 테스트" at=0,100 size=100x30\n@e3 TextField label="다른 입력칸" value="QA 테스트" id="other" at=0,200 size=100x30`);
      case 'mobile_click_on_screen_at_coordinates':
        return mode === 'focus-error' ? textResult('Focus failed', true) : textResult('ok');
      case 'mobile_type_keys':
        if (mode === 'input-error') return textResult('Keyboard failed', true);
        if (mode !== 'input-unrelated') value = args.text;
        return textResult('ok');
      case 'mobile_launch_app': return textResult('ok');
      default: throw new Error(`Unexpected mock call: ${name}`);
    }
  },
});
if (mode === 'dart-error') {
  state.dartConnected = true;
  state.dartP = Promise.resolve({ callTool: async () => textResult('Driver disconnected', true) });
}
await import('../../dist/index.js');
