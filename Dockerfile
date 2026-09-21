# syntax=docker/dockerfile:1

# ---- 构建阶段：安装依赖（随启动自动完成）并编译前后端 ----
FROM node:20-alpine AS build
WORKDIR /app

# 先拷贝清单以利用层缓存
COPY package.json package-lock.json* ./
RUN npm install

# 拷贝源码并构建（shared 几何引擎同时编译入服务端产物）
COPY tsconfig.json vite.config.ts ./
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY scripts ./scripts
RUN npm run build

# ---- 运行阶段 ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# 仅携带生产依赖与构建产物
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3000
# 将依赖纳入启动：直接以单条命令启动（见 compose）
CMD ["node", "server/dist/server/src/index.js"]
