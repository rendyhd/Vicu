# Vicu web: the web version of Vicu, served next to a Vikunja server (docs/web.md).
#
#   docker build -f docker/web/Dockerfile -t vicu-web .
#   docker run -p 8080:8080 -e VIKUNJA_URL=http://vikunja:3456 vicu-web

# --- Build the page -------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /src

# Only the web bundle is built: no Electron binary, no native speech library.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_audit=false

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build:web

# --- Serve it -------------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Where the Vikunja server is, as this container reaches it (no path, no trailing slash).
ENV VIKUNJA_URL=http://vikunja:3456 \
    VICU_MAX_UPLOAD=25m

COPY docker/web/security-headers.conf /etc/nginx/vicu/security-headers.conf
# The image's entry point fills in the two variables above and writes conf.d/default.conf.
COPY docker/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/out/web /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
