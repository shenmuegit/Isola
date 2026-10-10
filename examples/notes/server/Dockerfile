FROM node:24-bookworm-slim
WORKDIR /plugin
RUN npm install --omit=dev --ignore-scripts --package-lock=false fastify@5.12.5 pg@8.23.1
COPY package.json ./
COPY server ./server
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.ts"]
