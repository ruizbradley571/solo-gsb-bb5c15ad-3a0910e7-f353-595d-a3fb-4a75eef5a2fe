// 合唱视线遮挡几何引擎（React 前端与 Node 服务端共享）
//
// 判定模型（精确处理相切、重合、多人共线）：
//   舞台为平面，每位演唱者与指挥均为圆（站位人体横切面）。
//   对演唱者 S 到指挥 C 的视线参数化为 P(t) = S + t*(C-S), t ∈ [0,1]。
//   对每个其他站位圆 O（圆心 o，半径 r）求线段与圆的交点参数区间 [t1,t2]，
//   并将其夹取到 [0,1]：
//     · 整个区间在 [0,1] 之外 → 不遮挡（圆在指挥后方或演唱者后方）
//     · 圆心在圆内或 d≈0（站位重合）→ t1=0, t2=1（按 inside / coincident 处理）
//   交点恰好落在区间端点（disc=0，切点）记为 tangent；
//   切点位于 [0,1] 内即判定为遮挡（视线“擦到”其他站位边缘），
//   切点在端点外侧（例如 t1<0<t2 实为穿越）按穿越处理。
//   按 t1（沿视线首次进入遮挡者的距离参数）从小到大取最近遮挡者；
//   t1 相同（多圆边界共点，含多人共线）时以 t2 较大、再以 ID 决定，保证结果确定。

export interface Vec2 {
  x: number;
  y: number;
}

export interface Person extends Vec2 {
  id: string;
  /** 站位人体半径（世界坐标单位） */
  r: number;
}

export interface StageState {
  width: number;
  height: number;
  conductor: Person;
  singers: Person[];
}

export type OcclusionType = 'crossing' | 'tangent' | 'inside' | 'coincident';
export type SingerStatus = 'clear' | 'blocked' | 'coincident-conductor';

export interface OcclusionHit {
  /** 遮挡者（其他演唱者） */
  occluder: Person;
  kind: OcclusionType;
  /** 进入遮挡圆的视线参数 t ∈ [0,1]（0 表示起点即在圆内/重合） */
  entry: number;
  /** 离开遮挡圆的视线参数 t ∈ [0,1]（1 表示视线终点仍在圆内） */
  exit: number;
  entryPoint: Vec2;
  exitPoint: Vec2;
}

export interface BlockedRelation {
  singerId: string;
  occluderId: string;
  kind: OcclusionType;
  entry: number;
  exit: number;
  /** 是否为沿视线最近的遮挡者（决定着色） */
  nearest: boolean;
}

export interface SingerResult {
  singer: Person;
  status: SingerStatus;
  nearest: OcclusionHit | null;
  hits: OcclusionHit[];
}

export interface AnalysisResult {
  state: StageState;
  /** 每位演唱者的判定结果（顺序与输入一致） */
  results: SingerResult[];
  /** 全部受阻关系（按演唱者顺序、进入参数排序） */
  blockedRelations: BlockedRelation[];
  clearCount: number;
  blockedCount: number;
  /** 与指挥站位重合的演唱者 ID */
  coincidentWithConductor: string[];
  /** 互相重合的演唱者站位分组（坐标相同） */
  coincidentSingerGroups: string[][];
}

/** 几何计算容差（与世界单位无关的近零量） */
export const EPS = 1e-9;
/** 判定两点“重合”的距离（世界单位） */
export const COINCIDENT_EPS = 1e-7;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const pointAt = (s: Vec2, d: Vec2, t: number): Vec2 => ({
  x: s.x + d.x * t,
  y: s.y + d.y * t,
});

/**
 * 线段 S + t·D (t∈[0,1]) 与圆 (center, radius) 的相交区间。
 * 返回 null 表示线段（含端点）不与圆盘相交。
 */
export function segmentCircle(
  start: Vec2,
  dir: Vec2,
  center: Vec2,
  radius: number,
): { t1: number; t2: number; kind: OcclusionType } | null {
  const f = sub(start, center);
  const a = dot(dir, dir); // |D|²，segLen²；视线退化时单独处理
  const b = 2 * dot(f, dir);
  const c = dot(f, f) - radius * radius;

  if (a <= EPS) {
    // 零长视线（演唱者与指挥重合）：仅看点是否在圆内
    if (c <= EPS) return { t1: 0, t2: 1, kind: 'inside' };
    return null;
  }

  if (c <= EPS) {
    // 线段起点（演唱者中心）位于遮挡圆盘内：从 0 开始被挡
    const t2 = Math.min(1, Math.max(0, (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a)));
    return { t1: 0, t2, kind: 'inside' };
  }

  const disc = b * b - 4 * a * c;
  if (disc < -EPS) return null; // 无交点

  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  let t1 = (-b - sqrtDisc) / (2 * a);
  let t2 = (-b + sqrtDisc) / (2 * a);

  // 相切判定：判别式约等于 0，且切点在线段参数区间上
  const isTangent = disc <= EPS;

  // 夹取到 [0,1]
  t1 = Math.max(0, t1);
  t2 = Math.min(1, t2);
  if (t1 > t2 + EPS) return null; // 交点整体在线段之外（圆在身后/指挥后方）

  if (isTangent) return { t1, t2: t1, kind: 'tangent' };
  return { t1, t2, kind: 'crossing' };
}

function analyzeSinger(singer: Person, state: StageState): SingerResult {
  const s: Vec2 = { x: singer.x, y: singer.y };
  const c: Vec2 = { x: state.conductor.x, y: state.conductor.y };
  const d = sub(c, s);
  const segLen = len(d);

  if (segLen <= COINCIDENT_EPS) {
    // 演唱者站在指挥位置：视线退化，不参与遮挡判定
    return { singer, status: 'coincident-conductor', nearest: null, hits: [] };
  }

  const hits: OcclusionHit[] = [];
  for (const other of state.singers) {
    if (other.id === singer.id) continue;
    const centerDist = len(sub(other, singer));
    const hit = segmentCircle(s, d, other, other.r);
    if (!hit) continue;

    let kind = hit.kind;
    if (kind !== 'tangent' && centerDist <= COINCIDENT_EPS) {
      // 与遮挡者站位完全重合
      kind = 'coincident';
    }

    hits.push({
      occluder: other,
      kind,
      entry: hit.t1,
      exit: hit.t2,
      entryPoint: pointAt(s, d, hit.t1),
      exitPoint: pointAt(s, d, hit.t2),
    });
  }

  if (hits.length === 0) {
    return { singer, status: 'clear', nearest: null, hits: [] };
  }

  // 沿视线最近遮挡者：进入参数最小；并列时遮挡范围更长者优先，再以 ID 保证确定性
  hits.sort((p, q) =>
    Math.abs(p.entry - q.entry) > EPS
      ? p.entry - q.entry
      : Math.abs(q.exit - p.exit) > EPS
        ? q.exit - p.exit
        : p.occluder.id < q.occluder.id
          ? -1
          : 1,
  );

  return { singer, status: 'blocked', nearest: hits[0], hits };
}

function clusterCoincidentSingers(singers: Person[]): string[][] {
  const groups: string[][] = [];
  const used = new Array(singers.length).fill(false);
  for (let i = 0; i < singers.length; i++) {
    if (used[i]) continue;
    const group = [singers[i].id];
    used[i] = true;
    for (let j = i + 1; j < singers.length; j++) {
      if (used[j]) continue;
      if (len(sub(singers[i], singers[j])) <= COINCIDENT_EPS) {
        group.push(singers[j].id);
        used[j] = true;
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

export function analyzeStage(state: StageState): AnalysisResult {
  const results = state.singers.map((s) => analyzeSinger(s, state));

  const blockedRelations: BlockedRelation[] = [];
  let clearCount = 0;
  let blockedCount = 0;
  const coincidentWithConductor: string[] = [];

  for (const r of results) {
    if (r.status === 'coincident-conductor') {
      coincidentWithConductor.push(r.singer.id);
      continue;
    }
    if (r.status === 'clear') {
      clearCount++;
      continue;
    }
    blockedCount++;
    const nearestId = r.nearest!.occluder.id;
    for (const h of r.hits) {
      blockedRelations.push({
        singerId: r.singer.id,
        occluderId: h.occluder.id,
        kind: h.kind,
        entry: h.entry,
        exit: h.exit,
        nearest: h.occluder.id === nearestId,
      });
    }
  }

  return {
    state,
    results,
    blockedRelations,
    clearCount,
    blockedCount,
    coincidentWithConductor,
    coincidentSingerGroups: clusterCoincidentSingers(state.singers),
  };
}

// --------------------------- 展示用着色 ---------------------------

/** 由 ID 生成稳定且互相区分的颜色（多遮挡者着色） */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const sat = 70 + (h % 20);
  const light = 42 + ((h >> 4) % 12);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

export const KIND_LABEL: Record<OcclusionType, string> = {
  crossing: '穿越遮挡',
  tangent: '相切',
  inside: '起点在遮挡圆内',
  coincident: '站位重合',
};
