import { parseElements, resolve, check, summarize, state } from "../dist/core.js";
const raw = `One element per line
@e1 Other name="root" at=0,0 size=428x926
@e2 Button label="투두를 생성할게요" name="투두를 생성할게요" at=16,840 size=396x52 disabled
@e3 StaticText label="투두를 생성할게요" name="투두를 생성할게요" at=20,850 size=100x20
@e4 TextField label="제목을 입력해주세요" name="제목을 입력해주세요" id="todo_title" at=16,157 size=396x48
@e5 Button label="삭제" name="삭제" at=300,100 size=40x40
@e6 Button label="삭제" name="삭제" at=300,500 size=40x40
@e7 Button label="홈" name="홈" id="홈" at=0,818 size=85x52`;
const els = parseElements(raw);
const a = (c, msg) => { if (!c) { console.error("FAIL", msg); process.exitCode = 1; } else console.log("ok ", msg); };
a(els.length === 6, `중첩 중복 제거·root 포함 → ${els.length}`);
a(els.find(e => e.label === "홈").id === "", "라벨과 같은 id 는 식별자로 보지 않음");
a(resolve(els, { id: "todo_title" }).el?.type === "TextField", "id 로 선택");
const dup = resolve(els, { text: "삭제" }); a(!dup.el && dup.candidates?.length === 2, "동명 후보 2개면 누르지 않고 후보 반환");
a(resolve(els, { text: "삭제", index: 1 }).el?.y === 500, "index 로 지정");
state.lastRefs = new Map(els.map(e => [e.ref, e]));
const refOf = els.find(e => e.y === 500).ref; a(resolve(els, { ref: refOf }).el?.y === 500, `ref(${refOf}) 로 선택`);
a(resolve(parseElements(raw.replace('at=300,500', 'at=300,700')), { ref: refOf }).reason?.includes("사라졌"), "움직인 ref 는 거부");
a(check(els, { sel: { text: "투두를 생성할게요" }, state: "disabled" }).pass, "비활성 판정");
a(check(els, { sel: { text: "없는문구" }, state: "absent" }).pass, "absent 판정");
console.log(summarize(els, 10));
