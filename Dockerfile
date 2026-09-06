FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Ho_Chi_Minh

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/views ./dist/views
COPY src/public ./dist/public
COPY data/state.example.json ./data/state.example.json

RUN mkdir -p /var/data ./data

EXPOSE 3000

CMD ["node", "dist/index.js"]
