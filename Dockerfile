FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY . .
RUN npx prisma generate --schema=server/prisma/schema.prisma
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/client/package.json ./client/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY docker-entrypoint.mjs ./docker-entrypoint.mjs
RUN mkdir -p /app/uploads \
  && chown node:node /app/uploads \
  && chmod -R a+rX /app/server/prisma /app/server/dist /app/client/dist \
  && chmod a+rX /app/docker-entrypoint.mjs

EXPOSE 4000
USER node
ENTRYPOINT ["node", "docker-entrypoint.mjs"]
