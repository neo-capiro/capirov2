# Capiro marketing site container.
# Static HTML + assets served by nginx-unprivileged on port 8080.
# Build context: REPOSITORY ROOT.
#   docker buildx build --platform linux/arm64 -f marketing/Dockerfile -t capiro-marketing:local --push .

ARG NGINX_VERSION=1.27.1-alpine

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS runtime
USER root
RUN apk add --no-cache wget ca-certificates
COPY marketing/nginx/nginx.conf /etc/nginx/nginx.conf
RUN rm -rf /usr/share/nginx/html/* \
 && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx
COPY --chown=nginx:nginx marketing/index.html /usr/share/nginx/html/
COPY --chown=nginx:nginx marketing/assets /usr/share/nginx/html/assets
USER nginx
EXPOSE 8080
