import test from "node:test";
import assert from "node:assert/strict";
import { parseElements, snapshot, view, summarize, state } from "../dist/core.js";

const raw = (rows) => rows.map(([t, l, x, y, extra = ""]) => `@e Button label="${l}" ${extra} at=${x},${y} size=100x40`.replace("Button", t)).join("\n");
const read = (rows) => parseElements(raw(rows));
const base = [
  ["Button", "저장", 0, 100],
  ["Button", "취소", 0, 200],
  ["StaticText", "제목", 0, 300],
  ["Button", "삭제", 0, 400],
];

test("summarize omits coordinates unless asked", () => {
  const els = read(base);
  assert.doesNotMatch(summarize(els), /@\d/);
  assert.match(summarize(els, 60, true), /@\d+,\d+/);
});

test("first view is full; unchanged screen reports no change", () => {
  state.lastRefs = new Map();
  assert.match(view(read(base)), /^--- 화면 ---/);
  assert.match(view(read(base)), /변경 없음 \(4개 요소\)/);
});

test("diff lists only added/removed and keeps refs of unchanged elements", () => {
  state.lastRefs = new Map();
  view(read(base));
  const saveRef = [...state.lastRefs.values()].find((e) => e.label === "저장").ref;
  const out = view(read([...base.filter((r) => r[1] !== "취소"), ["Button", "새 버튼", 0, 500]]));
  assert.match(out, /\+1 −1 ~0/);
  assert.match(out, /\+ r\d+ \[Button\]새 버튼/);
  assert.match(out, /- "취소"/);
  assert.equal([...state.lastRefs.values()].find((e) => e.label === "저장").ref, saveRef);
});

test("mostly new screen falls back to full with fresh numbering", () => {
  state.lastRefs = new Map();
  view(read(base));
  const out = view(read([["Button", "A", 0, 100], ["Button", "B", 0, 200], ["Button", "C", 0, 300]]));
  assert.match(out, /^--- 화면 ---/);
  assert.equal(snapshot(read([["Button", "A", 0, 100]])).els[0].ref, "r1");
});

test("none mode returns nothing and leaves refs untouched", () => {
  state.lastRefs = new Map();
  view(read(base));
  const before = [...state.lastRefs.keys()].join();
  assert.equal(view(read([["Button", "다른", 0, 100]]), "none"), "");
  assert.equal([...state.lastRefs.keys()].join(), before);
});

test("whole-screen shift (scroll/keyboard) keeps refs and reports the move", () => {
  state.lastRefs = new Map();
  view(read(base));
  const before = new Map([...state.lastRefs.values()].map((e) => [e.label, e.ref]));
  const out = view(read([...base.map(([t, l, x, y]) => [t, l, x, y - 106]), ["Button", "닫기", 0, 600]]));
  assert.match(out, /\+1 −0 ~0, 유지 4, 화면 이동 y-106/);
  for (const e of state.lastRefs.values()) if (before.has(e.label)) assert.equal(e.ref, before.get(e.label));
});

test("unique id matches regardless of position", () => {
  state.lastRefs = new Map();
  const withId = [...base, ["Button", "툴바", 0, 800, 'id="Toolbar"']];
  view(read(withId));
  const ref = [...state.lastRefs.values()].find((e) => e.id === "Toolbar").ref;
  view(read(withId.map((r) => (r[1] === "툴바" ? [r[0], r[1], 0, 500, r[4]] : r))));
  assert.equal([...state.lastRefs.values()].find((e) => e.id === "Toolbar").ref, ref);
});

test("iOS keyboard folds into one line and keeps the return key reachable", () => {
  state.lastRefs = new Map();
  view(read(base));
  const keyboard = [
    ["Other", "inputView", 0, 700],
    ["Button", "shift", 0, 760],
    ["Key", "삭제", 300, 760, 'id="delete"'],
    ["Key", " ", 150, 820, 'id="space"'],
    ["Button", "검색", 300, 820, 'id="Search"'],
  ];
  const opened = view(read([...base, ...keyboard]));
  assert.match(opened, /\+0 −0 ~0/);
  assert.match(opened, /\+ ⌨ 키보드 열림 — return 키: r\d+ \[Button\]검색 id=Search/);
  assert.doesNotMatch(opened, /shift|삭제|inputView/);
  assert.match(summarize([...state.lastRefs.values()]), /^r\d+ \[Button\]저장[\s\S]*⌨ 키보드 열림/);
  assert.match(view(read(base)), /- ⌨ 키보드 닫힘/);
});
