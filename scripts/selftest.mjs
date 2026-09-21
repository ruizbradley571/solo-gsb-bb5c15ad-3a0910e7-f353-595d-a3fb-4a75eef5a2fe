// 几何引擎自测：node scripts/selftest.mjs（需先执行 tsc 构建 shared）
import assert from 'node:assert/strict';
import { analyzeStage, segmentCircle, colorForId } from '../server/dist/shared/occlusion.js';
import { normalizeStageState } from '../server/dist/shared/validate.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const D = { x: 100, y: 0 }; // 视线方向 (0,0)->(100,0)，长度 100

// 1. 不相交（视线在圆外）
test('视线从圆旁经过，不遮挡', () => {
  assert.equal(segmentCircle({ x: 0, y: 0 }, D, { x: 50, y: 30 }, 10), null);
});

// 2. 穿越：进入/离开参数正确
test('穿越遮挡圆，entry=0.4 exit=0.6', () => {
  const h = segmentCircle({ x: 0, y: 0 }, D, { x: 50, y: 0 }, 10);
  assert.ok(h);
  assert.equal(h.kind, 'crossing');
  assert.ok(Math.abs(h.t1 - 0.4) < 1e-9, `t1=${h.t1}`);
  assert.ok(Math.abs(h.t2 - 0.6) < 1e-9, `t2=${h.t2}`);
});

// 3. 精确相切
test('精确相切于 t=0.5，记为 tangent 且构成遮挡', () => {
  const h = segmentCircle({ x: 0, y: 0 }, D, { x: 50, y: 10 }, 10);
  assert.ok(h);
  assert.equal(h.kind, 'tangent');
  assert.ok(Math.abs(h.t1 - 0.5) < 1e-9);
  assert.ok(Math.abs(h.t2 - 0.5) < 1e-9);
});

// 4a. 圆在指挥后方
test('遮挡圆在指挥后方，不遮挡', () => {
  assert.equal(segmentCircle({ x: 0, y: 0 }, D, { x: 150, y: 0 }, 10), null);
});

// 4b. 圆在演唱者身后
test('遮挡圆在演唱者身后，不遮挡', () => {
  assert.equal(segmentCircle({ x: 0, y: 0 }, D, { x: -50, y: 0 }, 10), null);
});

// 4c. 圆越过指挥但覆盖视线终点 → 遮挡，exit 夹取为 1
test('圆覆盖指挥端，exit 夹取到 1', () => {
  const h = segmentCircle({ x: 0, y: 0 }, D, { x: 110, y: 0 }, 20);
  assert.ok(h && h.kind === 'crossing');
  assert.ok(Math.abs(h.t1 - 0.9) < 1e-9);
  assert.equal(h.t2, 1);
});

// 5. 相切于指挥端（切点 = t 1）
test('视线在指挥端与圆相切，判定为 tangent 遮挡', () => {
  const h = segmentCircle({ x: 0, y: 0 }, D, { x: 100, y: 10 }, 10);
  assert.ok(h);
  assert.equal(h.kind, 'tangent');
  assert.ok(Math.abs(h.t1 - 1) < 1e-9);
});

// 6. 演唱者中心位于遮挡圆边界（c=0 退化）
test('起点位于遮挡圆边界，按 inside 处理', () => {
  const h = segmentCircle({ x: 0, y: 0 }, D, { x: 0, y: 10 }, 10);
  assert.ok(h);
  assert.equal(h.kind, 'inside');
  assert.equal(h.t1, 0);
});

// 7. 完整场景分析：清晰/遮挡/共线最近者
test('多人共线时按最小 entry 取最近遮挡者', () => {
  const state = {
    width: 1000,
    height: 620,
    conductor: { id: 'conductor', x: 100, y: 0, r: 5 },
    singers: [
      { id: 's', x: 0, y: 0, r: 5 },
      { id: 'a', x: 30, y: 0, r: 8 },
      { id: 'b', x: 60, y: 0, r: 8 },
    ],
  };
  const res = analyzeStage(state).results.find((r) => r.singer.id === 's');
  assert.equal(res.status, 'blocked');
  assert.equal(res.nearest.occluder.id, 'a');
  assert.ok(Math.abs(res.nearest.entry - 0.22) < 1e-9);
  // 两个共线遮挡者都应列入受阻关系
  assert.deepEqual(res.hits.map((h) => h.occluder.id).sort(), ['a', 'b']);
});

// 8. 站位重合：两名演唱者坐标相同
test('站位重合按 coincident 处理，entry=0 且互相分组', () => {
  const state = {
    width: 1000,
    height: 620,
    conductor: { id: 'conductor', x: 100, y: 0, r: 5 },
    singers: [
      { id: 's1', x: 0, y: 0, r: 5 },
      { id: 's2', x: 0, y: 0, r: 5 },
    ],
  };
  const a = analyzeStage(state);
  const r1 = a.results.find((r) => r.singer.id === 's1');
  assert.equal(r1.status, 'blocked');
  assert.equal(r1.nearest.kind, 'coincident');
  assert.equal(r1.nearest.entry, 0);
  assert.deepEqual(a.coincidentSingerGroups, [['s1', 's2']]);
});

// 9. 演唱者与指挥重合
test('演唱者与指挥重合：状态 coincident-conductor，不判遮挡', () => {
  const state = {
    width: 1000,
    height: 620,
    conductor: { id: 'conductor', x: 42, y: 42, r: 5 },
    singers: [{ id: 's', x: 42, y: 42, r: 5 }],
  };
  const a = analyzeStage(state);
  assert.equal(a.results[0].status, 'coincident-conductor');
  assert.deepEqual(a.coincidentWithConductor, ['s']);
});

// 10. 相切场景集成判定
test('相切场景在完整分析中判定 blocked/tangent', () => {
  const state = {
    width: 1000,
    height: 620,
    conductor: { id: 'conductor', x: 100, y: 0, r: 5 },
    singers: [
      { id: 's', x: 0, y: 0, r: 5 },
      { id: 'a', x: 50, y: 10, r: 10 },
    ],
  };
  const r = analyzeStage(state).results.find((x) => x.singer.id === 's');
  assert.equal(r.status, 'blocked');
  assert.equal(r.nearest.kind, 'tangent');
});

// 11. entry 相同（两圆在同一处相切）时按 ID 确定性排序
test('entry 并列时结果确定（不抛错且稳定）', () => {
  const state = {
    width: 1000,
    height: 620,
    conductor: { id: 'conductor', x: 100, y: 0, r: 5 },
    singers: [
      { id: 's', x: 0, y: 0, r: 5 },
      { id: 'a', x: 50, y: 10, r: 10 },
      { id: 'b', x: 50, y: 10, r: 10 },
    ],
  };
  const a1 = analyzeStage(state);
  const a2 = analyzeStage(state);
  assert.equal(
    a1.results.find((r) => r.singer.id === 's').nearest.occluder.id,
    a2.results.find((r) => r.singer.id === 's').nearest.occluder.id,
  );
});

// 12. 受阻关系列表：nearest 标记与统计
test('blockedRelations 中仅最近者 nearest=true，统计正确', () => {
  const state = {
    width: 1000,
    height: 620,
    conductor: { id: 'conductor', x: 100, y: 0, r: 5 },
    singers: [
      { id: 's', x: 0, y: 0, r: 5 },
      { id: 'a', x: 30, y: 0, r: 8 }, // s 与 a 都沿视线被挡
      { id: 'b', x: 60, y: 0, r: 8 },
      { id: 'clear1', x: 0, y: 80, r: 5 },
    ],
  };
  const a = analyzeStage(state);
  // s 被 a(最近)、b 遮挡；a 被 b 遮挡；b、clear1 畅通
  assert.equal(a.blockedCount, 2);
  assert.equal(a.clearCount, 2);
  assert.equal(a.results.find((r) => r.singer.id === 'a').nearest.occluder.id, 'b');
  const rels = a.blockedRelations.filter((r) => r.singerId === 's');
  assert.equal(rels.length, 2);
  assert.equal(rels.filter((r) => r.nearest).length, 1);
  assert.equal(rels.find((r) => r.nearest).occluderId, 'a');
});

// 13. 着色稳定
test('colorForId 对同一 ID 稳定且为合法 hsl', () => {
  assert.match(colorForId('singer-1'), /^hsl\(\d+, \d+%, \d+%\)$/);
  assert.equal(colorForId('abc'), colorForId('abc'));
});

// 14. 导入校验
test('normalizeStageState 补默认值、去重 ID、报错非法输入', () => {
  const r = normalizeStageState({
    width: 500,
    conductor: { x: 10, y: 20 },
    singers: [
      { id: 'x', x: 1, y: 2, r: 9 },
      { id: 'x', x: 3, y: 4 },
      { x: 'bad' },
    ],
  });
  assert.equal(r.state.width, 500);
  assert.equal(r.state.conductor.id, 'conductor');
  assert.equal(r.state.conductor.r, 16);
  assert.equal(r.state.singers.length, 2);
  assert.notEqual(r.state.singers[1].id, 'x');
  assert.ok(r.warnings.length > 0);

  const bad = normalizeStageState('not-an-object');
  assert.ok(bad.errors.length > 0);
});

console.log(`\n全部 ${passed} 项自测通过 ✅`);
