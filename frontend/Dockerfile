# ExperimentOS dashboard. API_URL is baked into the /api rewrite at build time.
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG API_URL=http://api:8765
ENV API_URL=$API_URL
RUN pnpm build

FROM node:20-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["pnpm", "start"]
