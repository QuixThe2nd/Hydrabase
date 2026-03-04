FROM oven/bun AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun AS release
WORKDIR /app

RUN apt-get update && apt-get install -y gcc wget && \
    wget -O /tmp/su-exec.c https://raw.githubusercontent.com/ncopa/su-exec/master/su-exec.c && \
    gcc -o /usr/local/bin/su-exec /tmp/su-exec.c && \
    rm /tmp/su-exec.c && \
    apt-get remove -y gcc wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PUID=1000
ENV PGID=1000

EXPOSE 4545/tcp
EXPOSE 45454/udp

VOLUME ["/app/data"]

USER root
ENTRYPOINT ["/entrypoint.sh"]
