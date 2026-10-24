# The strfry sync server plus Node.js, which runs its write policy
# (strfry-write-policy.mjs: only Vessel's message kinds get through).
FROM ghcr.io/hoytech/strfry:latest
USER root
RUN apk add --no-cache nodejs
COPY --chmod=755 strfry-write-policy.mjs /app/write-policy.mjs
USER strfry
