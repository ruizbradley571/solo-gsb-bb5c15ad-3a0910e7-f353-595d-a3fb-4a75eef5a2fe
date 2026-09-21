import type { Person, StageState } from './occlusion.js';

export interface NormalizeOptions {
  defaultWidth?: number;
  defaultHeight?: number;
  defaultRadius?: number;
}

export interface NormalizeResult {
  state: StageState;
  errors: string[];
  warnings: string[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

let seq = 0;
const genId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * 解析并校验导入/接口提交的舞台 JSON，补全缺省值、去重 ID。
 * 宽容但可追溯：错误进 errors，降级处理进 warnings。
 */
export function normalizeStageState(
  raw: unknown,
  opts: NormalizeOptions = {},
): NormalizeResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const defaultWidth = opts.defaultWidth ?? 1000;
  const defaultHeight = opts.defaultHeight ?? 620;
  const defaultRadius = opts.defaultRadius ?? 16;

  if (typeof raw !== 'object' || raw === null) {
    return {
      state: { width: defaultWidth, height: defaultHeight, conductor: { id: 'conductor', x: 0, y: 0, r: 18 }, singers: [] },
      errors: ['顶层必须是 JSON 对象'],
      warnings,
    };
  }

  const obj = raw as Record<string, unknown>;

  const width = isNum(obj.width) && obj.width > 0 ? obj.width : (warnings.push(`舞台宽度无效，使用默认值 ${defaultWidth}`), defaultWidth);
  const height = isNum(obj.height) && obj.height > 0 ? obj.height : (warnings.push(`舞台高度无效，使用默认值 ${defaultHeight}`), defaultHeight);

  const readPerson = (p: unknown, fallbackId: string): Person | null => {
    if (typeof p !== 'object' || p === null) {
      errors.push(`站位 ${fallbackId} 不是对象，已忽略`);
      return null;
    }
    const po = p as Record<string, unknown>;
    const x = isNum(po.x) ? po.x : (errors.push(`站位 ${fallbackId} 缺少有效 x，已忽略`), null);
    const y = isNum(po.y) ? po.y : (errors.push(`站位 ${fallbackId} 缺少有效 y，已忽略`), null);
    if (x === null || y === null) return null;
    let r = isNum(po.r) ? po.r : defaultRadius;
    if (!isNum(po.r)) warnings.push(`站位 ${fallbackId} 半径缺失，使用默认值 ${defaultRadius}`);
    if (r <= 0) {
      warnings.push(`站位 ${fallbackId} 半径必须为正，已重置为 ${defaultRadius}`);
      r = defaultRadius;
    }
    let id = typeof po.id === 'string' && po.id.trim() ? po.id : genId('p');
    if (po.id !== id) warnings.push(`存在无效站位 ID，已自动生成 ${id}`);
    return { id, x, y, r };
  };

  let conductor: Person;
  const errorsBeforeConductor = errors.length;
  const c = readPerson(obj.conductor, 'conductor');
  if (c) {
    conductor = { ...c, id: 'conductor' };
  } else {
    // 用一条更明确的错误取代 readPerson 追加的细项
    errors.splice(errorsBeforeConductor, errors.length - errorsBeforeConductor);
    errors.push('缺少有效指挥对象，已使用默认指挥（坐标 500,520，半径 18）');
    conductor = { id: 'conductor', x: 500, y: 520, r: 18 };
  }

  const singers: Person[] = [];
  if (obj.singers !== undefined && !Array.isArray(obj.singers)) {
    errors.push('singers 必须是数组，已按空处理');
  } else if (Array.isArray(obj.singers)) {
    const seen = new Set<string>();
    obj.singers.forEach((item, i) => {
      const p = readPerson(item, `#${i}`);
      if (!p) return;
      if (seen.has(p.id)) {
        const newId = genId('singer');
        warnings.push(`演唱者 ID "${p.id}" 重复，已改为 ${newId}`);
        p.id = newId;
      }
      seen.add(p.id);
      singers.push(p);
    });
  }

  return { state: { width, height, conductor, singers }, errors, warnings };
}
