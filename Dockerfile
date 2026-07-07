FROM alpine:3.19 AS ffmpeg-stage
RUN apk add --no-cache curl && \
    curl -Ls https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    | tar xJ --strip-components=1 -C /tmp && \
    cp /tmp/ffmpeg /usr/local/bin/ffmpeg

FROM node:20-bookworm-slim
COPY --from=ffmpeg-stage /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
