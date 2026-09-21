import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeStage,
  colorForId,
  KIND_LABEL,
  type Person,
  type StageState,
  type Vec2,
} from '../../shared/occlusion';
import { normalizeStageState } from '../../shared/validate';
import { defaultScene } from './scene';
import { Stage, type Selection } from './Stage';

let addSeq = 100;

function NumberField({
  label,
  value,
  step = 1,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        step={step}
        min={min}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

export function App() {
  const [state, setState] = useState<StageState>(defaultScene);
  const [selection, setSelection] = useState<Selection>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => analyzeStage(state), [state]);

  const flash = (kind: 'error' | 'info', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 4000);
  };

  const updateConductor = (patch: Partial<Person>) =>
    setState((s) => ({ ...s, conductor: { ...s.conductor, ...patch } }));
  const updateSinger = (id: string, patch: Partial<Person>) =>
    setState((s) => ({
      ...s,
      singers: s.singers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));

  const handleMove = (sel: Exclude<Selection, null>, pos: Vec2) => {
    if (sel.kind === 'conductor') updateConductor(pos);
    else updateSinger(sel.id, pos);
  };
  const handleResize = (sel: Exclude<Selection, null>, r: number) => {
    if (sel.kind === 'conductor') updateConductor({ r });
    else updateSinger(sel.id, { r });
  };

  const addSinger = (pos: Vec2) => {
    // 避免与现有 ID 冲突
    let id = `s${++addSeq}`;
    const existing = new Set(state.singers.map((s) => s.id));
    while (existing.has(id)) id = `s${++addSeq}`;
    const singer: Person = { id, x: pos.x, y: pos.y, r: 20 };
    setState((s) => ({ ...s, singers: [...s.singers, singer] }));
    setSelection({ kind: 'singer', id });
  };

  const deleteSelected = () => {
    if (selection?.kind !== 'singer') return;
    const id = selection.id;
    setState((s) => ({ ...s, singers: s.singers.filter((p) => p.id !== id) }));
    setSelection(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------- 导入 / 导出 ----------------

  const exportJson = () => {
    const payload = {
      app: 'chorus-sightline-checker',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      stage: state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chorus-stage-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // 兼容导出包装格式与裸 StageState
      const candidate = parsed && typeof parsed === 'object' && 'stage' in parsed ? parsed.stage : parsed;
      const { state: next, errors, warnings } = normalizeStageState(candidate);
      if (errors.length > 0) {
        flash('error', `导入失败：${errors.join('；')}`);
        return;
      }
      setState(next);
      setSelection(null);
      addSeq = Math.max(addSeq, ...next.singers.map((p) => Number(/^s(\d+)$/.exec(p.id)?.[1] ?? 0)));
      flash('info', warnings.length ? `已导入（${warnings.length} 条警告）` : '舞台 JSON 已导入');
    } catch (err) {
      flash('error', `JSON 解析失败：${(err as Error).message}`);
    }
  };

  // ---------------- 侧栏数据 ----------------

  const selectedPerson: Person | null =
    selection?.kind === 'conductor'
      ? state.conductor
      : selection?.kind === 'singer'
        ? state.singers.find((p) => p.id === selection.id) ?? null
        : null;

  const relations = [...analysis.blockedRelations].sort((a, b) =>
    a.singerId === b.singerId ? a.entry - b.entry : a.singerId.localeCompare(b.singerId),
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>合唱视线遮挡检查台</h1>
        <div className="toolbar">
          <button onClick={() => setState(defaultScene)}>恢复示例</button>
          <button onClick={exportJson}>导出 JSON</button>
          <button onClick={() => fileRef.current?.click()}>导入 JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </div>
        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
      </header>

      <div className="body">
        <main className="stage-wrap">
          <Stage
            analysis={analysis}
            selection={selection}
            onMove={handleMove}
            onResize={handleResize}
            onSelect={setSelection}
            onAddSinger={addSinger}
          />
        </main>

        <aside className="sidebar">
          <section className="card stats">
            <div>
              <span className="stat-num clear">{analysis.clearCount}</span>
              <span className="stat-label">视线畅通</span>
            </div>
            <div>
              <span className="stat-num blocked">{analysis.blockedCount}</span>
              <span className="stat-label">受到遮挡</span>
            </div>
            <div>
              <span className="stat-num total">{state.singers.length}</span>
              <span className="stat-label">演唱者</span>
            </div>
          </section>

          {(analysis.coincidentWithConductor.length > 0 || analysis.coincidentSingerGroups.length > 0) && (
            <section className="card warnings">
              {analysis.coincidentWithConductor.map((id) => (
                <div key={`cc-${id}`}>⚠ {id} 与指挥站位重合，视线退化</div>
              ))}
              {analysis.coincidentSingerGroups.map((g, i) => (
                <div key={`g-${i}`}>⚠ {g.join('、')} 站位重合</div>
              ))}
            </section>
          )}

          <section className="card">
            <h2>{selection ? '属性' : '操作说明'}</h2>
            {selectedPerson ? (
              <div className="props">
                <div className="props-title">
                  {selection?.kind === 'conductor' ? '指挥' : selectedPerson.id}
                  {selection?.kind === 'singer' && (
                    <button className="danger" onClick={deleteSelected}>
                      删除该演唱者
                    </button>
                  )}
                </div>
                <div className="fields">
                  <NumberField label="X" value={selectedPerson.x} onChange={(x) => handleMove(selection!, { x, y: selectedPerson.y })} />
                  <NumberField label="Y" value={selectedPerson.y} onChange={(y) => handleMove(selection!, { x: selectedPerson.x, y })} />
                  <NumberField label="半径 r" min={1} value={selectedPerson.r} onChange={(r) => handleResize(selection!, r)} />
                </div>
              </div>
            ) : (
              <ul className="help">
                <li>拖动方形指挥或圆形站位改变位置</li>
                <li>点击任一站位选中，拖蓝色手柄或在右侧改半径</li>
                <li>双击舞台空白处添加演唱者</li>
                <li>绿色实线=视线畅通；彩色实线+同色虚线=被该颜色站位遮挡</li>
                <li>站位圆外发光颜色即“最近遮挡者”的着色</li>
              </ul>
            )}
          </section>

          <section className="card grow">
            <h2>受阻关系（{relations.length}）</h2>
            {relations.length === 0 ? (
              <p className="muted">当前没有任何视线被遮挡。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>演唱者</th>
                      <th>遮挡者</th>
                      <th>类型</th>
                      <th>进入 t</th>
                      <th>最近</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relations.map((r) => (
                      <tr
                        key={`${r.singerId}-${r.occluderId}`}
                        className={r.nearest ? 'nearest-row' : ''}
                        onClick={() => setSelection({ kind: 'singer', id: r.singerId })}
                      >
                        <td>{r.singerId}</td>
                        <td>
                          <span className="dot" style={{ background: colorForId(r.occluderId) }} />
                          {r.occluderId}
                        </td>
                        <td>{KIND_LABEL[r.kind]}</td>
                        <td>{r.entry.toFixed(3)}</td>
                        <td>{r.nearest ? '●' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
