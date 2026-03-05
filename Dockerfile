FROM oven/bun AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun AS release
WORKDIR /app

RUN apt-get update && apt-get install -y gosu && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
RUN chown -R 1000:1000 /app

ENV NODE_ENV=production
ENV PUID=1000
ENV PGID=1000

EXPOSE 4545/tcp
EXPOSE 4545/udp

VOLUME ["/app/data"]

USER root
ENTRYPOINT ["/entrypoint.sh"]
