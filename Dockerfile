# Base Image
FROM oven/bun AS base
WORKDIR /app

# Install Dependencies
FROM base AS install
RUN mkdir -p /temp/build
COPY package.json bun.lock /temp/build/
RUN cd /temp/build && bun install --frozen-lockfile

# Import Dependencies & Code
FROM base AS prerelease
COPY --from=install /temp/build/node_modules node_modules
COPY . .

# Copy Dependencies & Code into final image
FROM base AS release
COPY --from=prerelease /app/src/index.ts .
COPY --from=prerelease /app/package.json .

ENV NODE_ENV=production

# Start Hydrabase
USER bun
EXPOSE 4545/tcp
EXPOSE 45454/udp
CMD bun src
