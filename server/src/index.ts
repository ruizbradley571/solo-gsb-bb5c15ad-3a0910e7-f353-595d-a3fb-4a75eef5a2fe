import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { analyzeStage } from '../../shared/occlusion.js';
import { normalizeStageState } from '../../shared/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 编译产物位于 server/dist/server/src/index.js，前端产物位于 client/dist
const clientDist = resolve(__dirname, '../../../../client/dist');

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'chorus-sightline-checker' });
});

/**
 * POST /api/analyze
 * 请求体：舞台 JSON（StageState）
 * 响应：完整分析结果 AnalysisResult；校验失败返回 400 与错误明细
 */
app.post('/api/analyze', (req, res) => {
  const { state, errors, warnings } = normalizeStageState(req.body);
  if (errors.length > 0) {
    res.status(400).json({ ok: false, errors, warnings });
    return;
  }
  const analysis = analyzeStage(state);
  res.json({ ok: true, warnings, analysis });
});

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(resolve(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('合唱视线遮挡检查台 API 运行中。请先构建前端 (npm run build)。');
  });
}

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`合唱视线遮挡检查台已启动: http://localhost:${PORT}`);
});
