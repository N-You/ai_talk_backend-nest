# AI English Tutor - NestJS 后端镜像（生产构建）
FROM node:22-alpine

WORKDIR /app

# 编译原生依赖所需（bcryptjs 等）
RUN apk add --no-cache python3 make g++

# 先装依赖（利用缓存层）
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install --legacy-peer-deps

# 拷贝源码并编译（tsc 保留 src 目录结构，产物 dist/src/main.js，与 start:prod 对齐）
COPY . .
RUN npx tsc -p tsconfig.json && ls dist/src/main.js

EXPOSE 8002

CMD ["node", "dist/src/main.js"]
