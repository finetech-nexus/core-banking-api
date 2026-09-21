FROM node:20-slim AS builder

WORKDIR /usr/src/app

COPY package*.json ./
# tsup is a devDependency; the builder stage must install dev deps.
RUN npm ci --include=dev

COPY . .
RUN npm run build

# Production stage
FROM node:20-slim AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /usr/src/app/dist ./dist
# server.ts loads swagger doc from ../openapi.json at runtime.
COPY --from=builder /usr/src/app/openapi.json ./openapi.json
COPY --from=builder /usr/src/app/data ./data

EXPOSE 3000

CMD ["node", "dist/server.js"]
