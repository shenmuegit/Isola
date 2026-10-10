FROM isola-server
COPY test/fixtures/backend/server.mjs ./test/fixtures/backend/server.mjs
ARG HEALTH_VERSION
ENV HEALTH_VERSION=$HEALTH_VERSION
CMD ["node", "test/fixtures/backend/server.mjs"]
