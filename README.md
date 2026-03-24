# Supertonic TTS Service

On-device text-to-speech microservice using [Supertonic](https://github.com/supertone-inc/supertonic) (ONNX Runtime). Deployed as a Docker container, serving the Leo AI chatbot on [yuryprimakov.com](https://yuryprimakov.com).

Zero per-request cost. No external API keys. All inference runs locally on CPU.

## How It Works

```
Client sends text
    |
    v
POST /synthesize { text, voice_id, lang }
    |
    v
Supertonic ONNX pipeline:
  text -> duration predictor -> text encoder -> denoising diffusion -> vocoder
    |
    v
16-bit PCM WAV audio returned (44100 Hz, mono)
```

The service loads 4 ONNX models (~251MB total) into memory on startup. Subsequent requests run inference on CPU with no disk I/O.

---

## API Reference

### `POST /synthesize`

Generate speech audio from text.

**Request:**
```bash
curl -X POST https://tts.imadefire.com/synthesize \
  -H "Content-Type: application/json" \
  -H "x-tts-secret: YOUR_SECRET" \
  -d '{"text": "Hello, I am Leo.", "voice_id": "M2", "lang": "en"}' \
  --output output.wav
```

**Request body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `text` | string | Yes | | Text to synthesize (max ~5000 chars) |
| `voice_id` | string | No | `M2` | Voice preset: M1-M5 (male), F1-F5 (female) |
| `lang` | string | No | `en` | Language: `en`, `ko`, `es`, `pt`, `fr` |

**Response:** `audio/wav` binary

**Headers:**
- `Content-Type: audio/wav`
- `Content-Length: <bytes>`

**Error responses:**
| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "text is required"}` | Missing or invalid text |
| 400 | `{"error": "Invalid voice_id..."}` | Unrecognized voice preset |
| 401 | `{"error": "Unauthorized"}` | Missing or wrong `x-tts-secret` header |
| 503 | `{"error": "TTS engine not ready"}` | Models still loading (first request after start) |
| 500 | `{"error": "..."}` | Synthesis error |

### `GET /health`

Health check. No authentication required.

**Response:**
```json
{
  "status": "ok",
  "voices": ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]
}
```

---

## Voice Presets

| ID | Type | Character |
|----|------|-----------|
| M1 | Male | Clear |
| **M2** | **Male** | **Warm (default)** |
| M3 | Male | Deep |
| M4 | Male | Bright |
| M5 | Male | Smooth |
| F1 | Female | Clear |
| F2 | Female | Warm |
| F3 | Female | Bright |
| F4 | Female | Smooth |
| F5 | Female | Soft |

Preview all voices: https://supertone-inc.github.io/supertonic-py/voices/

Voice style JSON files are located in `models/voice_styles/`.

---

## ONNX Models

| File | Size | Purpose |
|------|------|---------|
| `duration_predictor.onnx` | 1.5 MB | Predicts phoneme durations from text |
| `text_encoder.onnx` | 27 MB | Encodes text into embedding vectors |
| `vector_estimator.onnx` | 127 MB | Denoising diffusion to estimate latent vectors |
| `vocoder.onnx` | 97 MB | Converts latent vectors to audio waveform |
| `tts.json` | 9 KB | Model configuration (sample rate, chunk sizes) |
| `unicode_indexer.json` | 257 KB | Maps Unicode characters to model input indices |
| **Total** | **~251 MB** | |

Models are sourced from Hugging Face: [Supertone/supertonic-2](https://huggingface.co/Supertone/supertonic-2)

Tracked in this repo via **Git LFS**. After cloning, run:
```bash
git lfs pull
```

---

## Local Development

### Prerequisites
- Node.js 20+
- Git LFS (`apt install git-lfs` or `brew install git-lfs`)

### Setup
```bash
git clone https://github.com/yprimakov/supertonic-tts-service.git
cd supertonic-tts-service
git lfs pull          # Download ONNX models (251MB)
npm install
```

### Run
```bash
node server.mjs
# Output:
# Loading Supertonic TTS models...
# Using CPU for inference
# Models loaded in 0.6s. Sample rate: 44100
# TTS service listening on port 3100
```

### Test
```bash
# Health check
curl http://localhost:3100/health

# Generate speech
curl -X POST http://localhost:3100/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "voice_id": "M2"}' \
  --output test.wav

# Play it (macOS)
afplay test.wav

# Play it (Linux)
aplay test.wav
```

### Environment Variables (optional for local dev)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `TTS_API_SECRET` | *(empty)* | If set, requires `x-tts-secret` header on `/synthesize` |
| `ALLOWED_ORIGINS` | `https://www.yuryprimakov.com,...` | CORS whitelist (comma-separated) |

---

## Docker Deployment

### Build locally
```bash
docker build -t supertonic-tts .
```

Image size is ~400MB (Node.js 20 slim + ONNX models + dependencies).

### Run with Docker Compose
```bash
# Create .env with a shared secret
echo "TTS_API_SECRET=$(openssl rand -hex 16)" > .env

docker compose up -d
```

### Production deployment (Hostinger VPS with Traefik)

The `docker-compose.yml` includes Traefik labels for automatic HTTPS routing. This assumes an existing Traefik instance on the `root_default` Docker network.

```bash
# Option 1: Deploy script (builds locally, uploads to VPS)
./deploy.sh mr-prime@<vps-ip>

# Option 2: Manual on VPS
cd /opt/supertonic-tts-service
sudo git pull && sudo git lfs pull
sudo docker compose up -d --build
```

### docker-compose.yml structure
```yaml
services:
  tts:
    build: .
    expose: ["3100"]
    labels:
      - traefik.enable=true
      - traefik.http.routers.tts.rule=Host(`tts.imadefire.com`)
      - traefik.http.routers.tts.entrypoints=websecure
      - traefik.http.routers.tts.tls.certresolver=mytlschallenge
      - traefik.http.services.tts.loadbalancer.server.port=3100
    networks: [traefik]

networks:
  traefik:
    external: true
    name: root_default
```

---

## Integration with yuryprimakov.com

The main portfolio site (hosted on Vercel) proxies TTS requests through its own API route to avoid CORS issues and protect the shared secret.

### Flow
1. `ChatWindow.tsx` calls `POST /api/chat/tts` with `{ text }` after Leo responds
2. `/api/chat/tts/route.ts` reads `voice_id` from `chatbot_config` DB table
3. Route proxies to `TTS_SERVICE_URL/synthesize` with the `x-tts-secret` header
4. WAV audio is returned to the browser and played via the Web Audio API

### Required Vercel environment variables
| Variable | Value |
|----------|-------|
| `TTS_SERVICE_URL` | `https://tts.imadefire.com` |
| `TTS_API_SECRET` | Must match the VPS `.env` value |

### Admin controls (Admin > RAG Chatbot > Edit Identity)
- **Voice selector:** Choose from M1-M5, F1-F5
- **TTS toggle:** Enable/disable voice responses globally
- **User mute:** Each user can mute/unmute via the chat header icon (persisted in localStorage)

---

## Infrastructure

### Current deployment

| Detail | Value |
|--------|-------|
| VPS | Hostinger `srv1148428` |
| SSH user | `mr-prime` |
| Container path | `/opt/supertonic-tts-service` |
| Domain | `tts.imadefire.com` |
| DNS | Cloudflare A record -> `72.60.66.119` (DNS only, not proxied) |
| Reverse proxy | Traefik (shared with n8n.imadefire.com) |
| SSL | Let's Encrypt via Traefik `mytlschallenge` resolver |
| Docker network | `root_default` (shared with Traefik + n8n) |

### Resource usage
| Resource | Limit |
|----------|-------|
| Memory | 1 GB |
| CPU | 1 core |
| Disk (models) | ~251 MB |

---

## Performance

| Metric | Value |
|--------|-------|
| Model load time | ~0.6s (first request only) |
| Synthesis (short text) | ~0.1s |
| Synthesis (paragraph) | ~0.5-1.0s |
| End-to-end with network | ~1.5s (Vercel -> Hostinger -> browser) |
| Denoising steps | 4 (configurable in server.mjs) |
| Speech speed | 1.05x (configurable in server.mjs) |
| Output format | 16-bit PCM WAV, 44100 Hz, mono |

---

## Maintenance

### View logs
```bash
sudo docker logs supertonic-tts-service-tts-1 --tail 50
sudo docker logs supertonic-tts-service-tts-1 -f    # follow live
```

### Restart
```bash
cd /opt/supertonic-tts-service
sudo docker compose restart
```

### Update code
```bash
cd /opt/supertonic-tts-service
sudo git pull
sudo docker compose up -d --build
```

### Update ONNX models
1. Download new models from [Hugging Face](https://huggingface.co/Supertone/supertonic-2)
2. Replace files in `models/onnx/`
3. Commit (Git LFS tracks `.onnx` files automatically)
4. Push to GitHub
5. On VPS:
```bash
cd /opt/supertonic-tts-service
sudo git pull && sudo git lfs pull
sudo docker compose up -d --build
```

### Change shared secret
1. On VPS: edit `/opt/supertonic-tts-service/.env`
2. Restart: `sudo docker compose restart`
3. Update `TTS_API_SECRET` in Vercel env vars
4. Redeploy Vercel

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `curl /health` times out | Container not running | `sudo docker compose up -d` |
| 401 Unauthorized | Secret mismatch | Verify `TTS_API_SECRET` in VPS `.env` and Vercel |
| 503 "TTS engine not ready" | Models still loading | Wait a few seconds, retry |
| 503 "TTS service not configured" | `TTS_SERVICE_URL` missing in Vercel | Add env var, redeploy |
| SSL certificate error | DNS not propagated | Check `dig tts.imadefire.com`, wait for propagation |
| SSL certificate error | Traefik can't reach Let's Encrypt | `sudo docker logs root-traefik-1` |
| No audio in browser | TTS disabled in admin | Admin > RAG > Voice > toggle on |
| No audio in browser | User muted | Click volume icon in chat header |
| Slow first response | Cold start (model loading) | Normal, ~0.6s. Subsequent requests are fast |
| CORS error | Origin not in whitelist | Update `ALLOWED_ORIGINS` in docker-compose.yml, restart |

---

## Cost

| Item | Cost |
|------|------|
| Supertonic | Free (MIT license) |
| ONNX Runtime | Free (MIT license) |
| Hostinger VPS | Included (shared with n8n) |
| Per-request cost | $0 |
| External API calls | None |

---

## License

This service wraps [Supertonic](https://github.com/supertone-inc/supertonic) which is MIT licensed.
