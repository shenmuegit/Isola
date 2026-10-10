FROM docker:26-cli AS docker
FROM node:24-bookworm-slim
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
RUN npm install -g pnpm@10.30.2
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @isola/plugin build && pnpm --filter @isola/client build
WORKDIR /workspace/apps/server
CMD ["node", "src/index.ts"]
