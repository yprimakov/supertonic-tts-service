# Supertonic TTS Service

On-device text-to-speech microservice using [Supertonic](https://github.com/supertone-inc/supertonic) (ONNX Runtime). Deployed as a Docker container on Hostinger VPS, serving the Leo AI chatbot on [yuryprimakov.com](https://yuryprimakov.com).

## Architecture

- **Express server** with a single `POST /synthesize` endpoint
- **Supertonic ONNX models** baked into the Docker image (~400MB)
- **Caddy** reverse proxy for auto-HTTPS via Let's Encrypt
- **10 voice presets** (M1-M5 male, F1-F5 female)
- **~0.1s** per response after model load

## API

### `POST /synthesize`

```json
{ "text": "Hello world", "voice_id": "M2", "lang": "en" }
```

Returns `audio/wav` binary.

### `GET /health`

Returns `{ "status": "ok", "voices": ["M1", ...] }`

## Deployment

```bash
# 1. Point DNS: tts.yuryprimakov.com -> your VPS IP

# 2. Deploy
./deploy.sh root@<your-vps-ip>

# 3. Add env vars to Vercel:
#    TTS_SERVICE_URL=https://tts.yuryprimakov.com
#    TTS_API_SECRET=<from .env on server>
```

## Local Development

```bash
npm install
node server.mjs
# Listening on port 3100
curl -X POST http://localhost:3100/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello","voice_id":"M2"}' \
  --output test.wav
```

## Voice Samples

Preview voices at: https://supertone-inc.github.io/supertonic-py/voices/

## Models

ONNX models are stored via Git LFS (~251MB). After cloning:

```bash
git lfs pull
```
