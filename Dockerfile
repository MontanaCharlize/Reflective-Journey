ARG NODE_VERSION=24.13.1
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# evals is deliberately retained in the build context: tests read its fixtures.
RUN npm run build && npm test

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 COMMUNITY_DB_PATH=/app/data/community.sqlite AI_ALLOW_LOCAL_GUEST=false
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --from=build --chown=node:node /app/dist ./dist
# The production server uses only Node built-ins; frontend dependencies are built into dist.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "server/serve.mjs"]
