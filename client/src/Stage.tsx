import { useRef, useState } from 'react';
import type { AnalysisResult, Person, Vec2 } from '../../shared/occlusion';
import { colorForId } from '../../shared/occlusion';

export type Selection = { kind: 'conductor' } | { kind: 'singer'; id: string } | null;

interface StageProps {
  analysis: AnalysisResult;
  selection: Selection;
  onMove: (sel: Exclude<Selection, null>, pos: Vec2) => void;
  onResize: (sel: Exclude<Selection, null>, r: number) => void;
  onSelect: (sel: Selection) => void;
  onAddSinger: (pos: Vec2) => void;
}

type Drag =
  | { mode: 'move'; target: Exclude<Selection, null> }
  | { mode: 'resize'; target: Exclude<Selection, null>; startR: number; startDist: number; center: Vec2 }
  | null;

export function Stage({ analysis, selection, onMove, onResize, onSelect, onAddSinger }: StageProps) {
  const { state } = analysis;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);

  const toWorld = (clientX: number, clientY: number): Vec2 => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * state.width,
      y: ((clientY - rect.top) / rect.height) * state.height,
    };
  };

  const clamp = (p: Vec2): Vec2 => ({
    x: Math.max(0, Math.min(state.width, p.x)),
    y: Math.max(0, Math.min(state.height, p.y)),
  });

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toWorld(e.clientX, e.clientY);
    if (drag.mode === 'move') {
      onMove(drag.target, clamp(p));
    } else {
      const d = Math.hypot(p.x - drag.center.x, p.y - drag.center.y);
      onResize(drag.target, Math.max(4, drag.startR + (d - drag.startDist)));
    }
  };

  const endDrag = () => setDrag(null);

  const startMove = (e: React.PointerEvent, target: Exclude<Selection, null>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelect(target);
    setDrag({ mode: 'move', target });
  };

  const startResize = (e: React.PointerEvent, person: Person, target: Exclude<Selection, null>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelect(target);
    const p = toWorld(e.clientX, e.clientY);
    setDrag({
      mode: 'resize',
      target,
      startR: person.r,
      startDist: Math.hypot(p.x - person.x, p.y - person.y),
      center: { x: person.x, y: person.y },
    });
  };

  const onBackgroundDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-person]')) return;
    onAddSinger(clamp(toWorld(e.clientX, e.clientY)));
  };

  // 所有作为“最近遮挡者”出现的演唱者（按其自身颜色高亮）
  const occluderColors = new Map<string, string>();
  for (const r of analysis.results) {
    if (r.nearest) occluderColors.set(r.nearest.occluder.id, colorForId(r.nearest.occluder.id));
  }

  const selectedId = selection?.kind === 'singer' ? selection.id : null;

  return (
    <svg
      ref={svgRef}
      className="stage"
      viewBox={`0 0 ${state.width} ${state.height}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onDoubleClick={onBackgroundDoubleClick}
      onPointerDown={() => onSelect(null)}
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e6eaf2" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={state.width} height={state.height} fill="url(#grid)" />

      {/* 视线 */}
      {analysis.results.map((r) => {
        const s = r.singer;
        const c = state.conductor;
        if (r.status === 'coincident-conductor') {
          return (
            <g key={`line-${s.id}`}>
              <line x1={s.x - 10} y1={s.y - 10} x2={s.x + 10} y2={s.y + 10} stroke="#d11" strokeWidth={2.5} />
              <line x1={s.x - 10} y1={s.y + 10} x2={s.x + 10} y2={s.y - 10} stroke="#d11" strokeWidth={2.5} />
            </g>
          );
        }
        if (r.status === 'clear' || !r.nearest) {
          return (
            <line
              key={`line-${s.id}`}
              x1={s.x}
              y1={s.y}
              x2={c.x}
              y2={c.y}
              stroke="#2ea043"
              strokeWidth={1.6}
              opacity={0.75}
            />
          );
        }
        const h = r.nearest;
        const occluderColor = colorForId(h.occluder.id);
        return (
          <g key={`line-${s.id}`}>
            {/* 可见段：演唱者 → 进入遮挡圆的切点/交点 */}
            <line x1={s.x} y1={s.y} x2={h.entryPoint.x} y2={h.entryPoint.y} stroke={occluderColor} strokeWidth={2.4} />
            {/* 受阻段：进入 → 指挥 */}
            <line
              x1={h.entryPoint.x}
              y1={h.entryPoint.y}
              x2={c.x}
              y2={c.y}
              stroke={occluderColor}
              strokeWidth={1.4}
              strokeDasharray="7 6"
              opacity={0.55}
            />
            {h.kind === 'tangent' && (
              <rect
                x={h.entryPoint.x - 5}
                y={h.entryPoint.y - 5}
                width={10}
                height={10}
                transform={`rotate(45 ${h.entryPoint.x} ${h.entryPoint.y})`}
                fill="#fff"
                stroke={occluderColor}
                strokeWidth={2}
              />
            )}
          </g>
        );
      })}

      {/* 演唱者 */}
      {state.singers.map((p) => {
        const isSelected = selectedId === p.id;
        const halo = occluderColors.get(p.id);
        return (
          <g
            key={p.id}
            data-person
            style={{ cursor: drag?.mode === 'move' ? 'grabbing' : 'grab' }}
            onPointerDown={(e) => startMove(e, { kind: 'singer', id: p.id })}
          >
            {halo && <circle cx={p.x} cy={p.y} r={p.r + 7} fill="none" stroke={halo} strokeWidth={3} opacity={0.85} />}
            <circle
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={halo ? `${halo}` : '#9ec5fe'}
              fillOpacity={halo ? 0.18 : 0.5}
              stroke={isSelected ? '#0b5fff' : '#2b4a7a'}
              strokeWidth={isSelected ? 3.5 : 2}
            />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={13} fontWeight={600} fill="#10233f" pointerEvents="none">
              {p.id}
            </text>
            {isSelected && (
              <g
                onPointerDown={(e) => {
                  const person = state.singers.find((q) => q.id === p.id)!;
                  startResize(e, person, { kind: 'singer', id: p.id });
                }}
                style={{ cursor: 'nwse-resize' }}
              >
                <line x1={p.x + p.r} y1={p.y} x2={p.x + p.r + 14} y2={p.y} stroke="#0b5fff" strokeWidth={2} />
                <circle cx={p.x + p.r + 14} cy={p.y} r={5} fill="#fff" stroke="#0b5fff" strokeWidth={2.5} />
              </g>
            )}
          </g>
        );
      })}

      {/* 指挥 */}
      <g
        data-person
        style={{ cursor: 'grab' }}
        onPointerDown={(e) => startMove(e, { kind: 'conductor' })}
      >
        <rect
          x={state.conductor.x - state.conductor.r}
          y={state.conductor.y - state.conductor.r}
          width={state.conductor.r * 2}
          height={state.conductor.r * 2}
          rx={4}
          fill="#ffd9a0"
          fillOpacity={0.85}
          stroke={selection?.kind === 'conductor' ? '#0b5fff' : '#9a5a00'}
          strokeWidth={selection?.kind === 'conductor' ? 3.5 : 2.5}
        />
        <text x={state.conductor.x} y={state.conductor.y + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#5c3400" pointerEvents="none">
          指挥
        </text>
        {selection?.kind === 'conductor' && (
          <g
            onPointerDown={(e) => startResize(e, state.conductor, { kind: 'conductor' })}
            style={{ cursor: 'nwse-resize' }}
          >
            <line
              x1={state.conductor.x + state.conductor.r}
              y1={state.conductor.y}
              x2={state.conductor.x + state.conductor.r + 14}
              y2={state.conductor.y}
              stroke="#0b5fff"
              strokeWidth={2}
            />
            <circle cx={state.conductor.x + state.conductor.r + 14} cy={state.conductor.y} r={5} fill="#fff" stroke="#0b5fff" strokeWidth={2.5} />
          </g>
        )}
      </g>

      {/* 图例提示 */}
      <text x={12} y={state.height - 12} fontSize={12} fill="#7a869c" pointerEvents="none">
        双击空白处添加演唱者 · 拖动圆移动 · 选中后拖蓝色手柄调整半径 · Delete 删除选中演唱者
      </text>
      {analysis.results.some((r) => r.nearest?.kind === 'tangent') && (
        <text x={12} y={20} fontSize={12} fill="#b35a00" pointerEvents="none">
          ◇ 标记视线与站位圆的切点（相切按遮挡处理）
        </text>
      )}
    </svg>
  );
}
