# Node 20 reached end of life in April 2026, so the image uses the current LTS (24).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    PGLITE_DIR=/app/data/pglite \
    UPLOAD_DIR=/app/data/uploads
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/views ./src/views
COPY src/db/migrations ./src/db/migrations
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
# Only used without DATABASE_URL / S3_BUCKET (embedded database and local uploads).
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
