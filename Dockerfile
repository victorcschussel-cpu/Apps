FROM node:22-slim AS build
WORKDIR /app
# Fallback caso o better-sqlite3 não ache binário pré-compilado
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/glicemia.db WEB_DIR=/app/dist/web PORT=8080 TZ_DISPLAY=America/Sao_Paulo
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
