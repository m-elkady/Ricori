FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
ARG NODE_VERSION=26.13.1
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils libatomic1; \
    case "$(dpkg --print-architecture)" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo 'Supported architectures: amd64 and arm64'; exit 1 ;; \
    esac; \
    cd /tmp; \
    curl --fail --show-error --silent --location --retry 3 --output node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    curl --fail --show-error --silent --location --retry 3 --output SHASUMS256.txt "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " node-v${NODE_VERSION}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sed 's/  .*/  node.tar.xz/' | sha256sum --check -; \
    tar -xJf node.tar.xz -C /usr/local --strip-components=1 --no-same-owner; \
    test "$(node --version)" = "v${NODE_VERSION}"; \
    groupadd --gid 1000 node; \
    useradd --uid 1000 --gid node --create-home node; \
    rm -f /tmp/node.tar.xz /tmp/SHASUMS256.txt; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node test ./test
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts
RUN npm run build
EXPOSE 3100
CMD ["node", "dist/src/server.js"]
