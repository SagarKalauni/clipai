FROM node:20-slim

# Install system dependencies: python3, ffmpeg, curl, wget, git
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp via pip3
RUN pip3 install --break-system-packages -U yt-dlp

WORKDIR /app

# Copy package files and install npm dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Ensure video temp folder is ready
RUN mkdir -p tmp_videos && chmod -R 777 tmp_videos

ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
