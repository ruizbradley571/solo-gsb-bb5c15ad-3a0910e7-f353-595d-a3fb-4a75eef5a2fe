# 合唱视线遮挡检查台（Chorus Sightline Checker）

在平面舞台上拖放**指挥**与**圆形站位**、调整人体半径，系统**实时**判定每位演唱者到指挥的视线线段是否被其他站位圆遮挡，精确处理**相切、重合与多人共线**，按沿视线的**最近遮挡者**着色，并列出全部受阻关系。支持舞台 JSON 导入 / 导出。

技术栈：React 18 + TypeScript（Vite）· Node.js 20 + Express · 几何引擎前后端共享（TypeScript）· Docker / Docker Compose。

---

## 一条命令启动

```bash
docker compose up --build
```

启动后在浏览器访问：

> **http://localhost:3000**

端口：**3000**（容器内与宿主机均为 3000，可用 `PORT` 环境变量 / compose 端口映射修改）。

首次启动会在镜像构建阶段自动安装全部依赖，无需手动 `npm install`。停止：`Ctrl+C`（后台运行则 `docker compose down`）。

---

## 功能与操作

| 操作 | 方式 |
| --- | --- |
| 移动指挥 / 演唱者 | 直接拖动方形指挥或圆形站位 |
| 调整人体半径 | 点击选中后拖圆右侧的蓝色手柄，或在右侧面板填写 `半径 r` |
| 添加演唱者 | 双击舞台空白处（默认半径 20） |
| 删除演唱者 | 选中后按 `Delete`，或右侧面板点“删除” |
| 精确编辑坐标 | 选中后在右侧面板填写 X / Y / r |
| 导入 / 导出 | 顶栏“导出 JSON”下载当前舞台；“导入 JSON”读取舞台文件 |

界面含义：

- **绿色实线**：视线畅通。
- **彩色实线 + 同色虚线**：视线被遮挡。实线为演唱者到遮挡圆入口的可见段，虚线为遮挡圆入口到指挥的受阻段；该颜色同时以“外发光”标在遮挡站位圆上，即**按沿视线最近遮挡者着色**。
- **菱形标记 ◇**：视线与站位圆的**切点**。
- 右侧“受阻关系”表列出每一对“演唱者 → 遮挡者”，含遮挡类型与视线进入参数 `t`（0=演唱者端，1=指挥端，越小越靠近演唱者），`●` 标记最近遮挡者。点击行会选中对应演唱者。
- 统计卡片显示畅通 / 受阻 / 总人数；重合站位会在警告条中列出。

---

## 判定模型（几何约定）

舞台为二维平面，演唱者与指挥均表示为圆。对演唱者 `S` 到指挥 `C` 的视线参数化：

```
P(t) = S + t·(C − S),   t ∈ [0,1]
```

对每个其他站位圆求线段与圆盘的相交参数区间 `[t1, t2]`（解析二次方程），并夹取到 `[0,1]`：

- 判别式 `< 0`：无交点，不遮挡；整个交点区间落在 `[0,1]` 之外（圆在演唱者身后或指挥后方）同样不遮挡。
- 判别式 `≈ 0`（切点在线段上）：记为**相切（tangent）**，按遮挡处理——视线“擦到”了相邻站位边缘。切点在 `t=1`（指挥端相切）同样计为遮挡；圆只在身后相切则不计。
- 两个交点：记为**穿越（crossing）**；圆覆盖指挥端时 `t2` 夹取为 `1`。
- 演唱者中心位于其他站位圆内：`t1=0`，记为**起点在圆内（inside）**。
- 与遮挡者坐标相同（距离 ≤ 1e-7 世界单位）：记为**站位重合（coincident）**，同坐标演唱者会分组列出。
- 演唱者与指挥重合：视线退化，状态为 `coincident-conductor`，单独警告，不参与遮挡判定。
- **多人共线**：对一名演唱者同时命中的所有遮挡者，按 `t1`（进入位置）从小到大排序，取最小者为**最近遮挡者**并据其稳定哈希颜色着色；`t1` 并列时以遮挡区间更长、再以 ID 排序，保证结果确定。全部命中对都会进入受阻关系列表，不止最近者。

计算使用双精度浮点，几何零值容差 `1e-9`，重合距离阈值 `1e-7`。

---

## JSON 格式

导出文件为带元信息的包装格式，导入同时接受该包装与裸舞台对象：

```json
{
  "app": "chorus-sightline-checker",
  "schemaVersion": 1,
  "exportedAt": "2026-09-21T00:00:00.000Z",
  "stage": {
    "width": 1000,
    "height": 620,
    "conductor": { "id": "conductor", "x": 500, "y": 540, "r": 18 },
    "singers": [
      { "id": "s1", "x": 250, "y": 350, "r": 20 }
    ]
  }
}
```

- 单位为舞台世界坐标；`r` 为站位人体半径，必须为正（缺省 16）。
- 重复 / 缺失 ID 会自动补全并给出警告；缺少有效指挥等致命错误会拒绝导入并提示。

### HTTP API

生产部署中 Express 同时托管前端与接口：

- `GET /api/health` — 健康检查。
- `POST /api/analyze` — 请求体为舞台 JSON（裸 `stage` 内容），返回完整分析结果（每位演唱者状态、全部命中对、最近遮挡者、统计、重合分组）；校验失败返回 `400` 与错误明细。

```bash
curl -s http://localhost:3000/api/health
curl -s -X POST http://localhost:3000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"width":1000,"height":620,"conductor":{"id":"conductor","x":100,"y":0,"r":5},
       "singers":[{"id":"s","x":0,"y":0,"r":5},{"id":"a","x":50,"y":0,"r":10}]}'
```

---

## 本地开发（不使用 Docker）

要求 Node.js ≥ 20。

```bash
npm install

# 终端 1：服务端（TS 增量编译到 server/dist，并以 --watch 运行）
npm run dev:server      # 监听重编译
npm run serve           # 另开终端启动 Express（http://localhost:3000）

# 终端 2：前端 Vite 开发服务器（/api 代理到 3000）
npm run dev:client      # http://localhost:5173
```

生产构建与启动：

```bash
npm run build           # 编译服务端/shared + 构建前端到 client/dist
npm start               # http://localhost:3000
```

几何引擎自测（覆盖穿越、精确相切、端点相切、遮挡在身后、起点在圆内、站位重合、多人共线、导入校验等 16 项）：

```bash
npm run selftest
```

## 项目结构

```
shared/occlusion.ts      视线遮挡几何引擎（前后端共享）
shared/validate.ts       舞台 JSON 规范化与校验
server/src/index.ts      Express：/api/analyze、/api/health 与静态托管
client/src/Stage.tsx     SVG 舞台：拖放、半径手柄、视线与切点/着色绘制
client/src/App.tsx       侧栏：统计、受阻关系表、属性编辑、导入导出
scripts/selftest.mjs     几何引擎自测
Dockerfile / compose.yaml 容器化交付
```
