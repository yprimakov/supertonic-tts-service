#!/bin/bash
# Deploy TTS service to Hostinger VPS
# Usage: ./deploy.sh <user>@<host>

set -e

REMOTE="${1:?Usage: ./deploy.sh user@host}"
REMOTE_DIR="/opt/tts-service"

echo "==> Building Docker image locally..."
docker build -t supertonic-tts .

echo "==> Saving image..."
docker save supertonic-tts | gzip > /tmp/supertonic-tts.tar.gz

echo "==> Uploading to $REMOTE..."
scp /tmp/supertonic-tts.tar.gz "$REMOTE:/tmp/"
scp docker-compose.yml Caddyfile "$REMOTE:$REMOTE_DIR/"

echo "==> Loading image and starting on remote..."
ssh "$REMOTE" << 'ENDSSH'
mkdir -p /opt/tts-service
cd /opt/tts-service
docker load < /tmp/supertonic-tts.tar.gz
rm /tmp/supertonic-tts.tar.gz

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo "TTS_API_SECRET=$(openssl rand -hex 16)" > .env
  echo "Created .env with random TTS_API_SECRET"
  cat .env
fi

docker compose up -d
echo "==> TTS service is running"
docker compose ps
ENDSSH

echo ""
echo "==> Done! Next steps:"
echo "  1. Point DNS: tts.yuryprimakov.com -> your Hostinger VPS IP"
echo "  2. Add to Vercel env vars:"
echo "     TTS_SERVICE_URL=https://tts.yuryprimakov.com"
echo "     TTS_API_SECRET=<the value from .env on the server>"
echo "  3. Test: curl https://tts.yuryprimakov.com/health"
