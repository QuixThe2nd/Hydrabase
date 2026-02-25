FROM oven/bun
WORKDIR /app

COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY --chown=bun:bun . .

USER bun
ENV NODE_ENV=production

EXPOSE 4545/tcp
EXPOSE 45454/udp
CMD bun src; sleep 3600
