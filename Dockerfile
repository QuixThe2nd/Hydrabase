# Base Image
FROM oven/bun AS base
WORKDIR /app

# Install Dependencies
FROM base AS install
RUN mkdir -p /temp/build
COPY package.json bun.lock /temp/build/
RUN cd /temp/build && bun install --frozen-lockfile

# Import Dependencies & Code
FROM base AS release
COPY --from=install /temp/build/node_modules node_modules
COPY . .

ENV NODE_ENV=production

# Start Hydrabase
USER bun
EXPOSE 4545/tcp
EXPOSE 45454/udp
CMD ls; bun run src/index.ts; sleep 3600
