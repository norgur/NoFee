FROM node:22-alpine

WORKDIR /app

# Install server dependencies first (layer cached unless package.json changes)
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev

# Copy server source and frontend
COPY server/server.js ./server/
COPY frontend/ ./frontend/

# Music directory will be mounted as a volume at runtime
RUN mkdir -p /music

ENV PORT=3000
ENV MUSIC_DIR=/music

EXPOSE 3000

CMD ["node", "server/server.js"]
