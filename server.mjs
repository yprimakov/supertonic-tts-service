import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadTextToSpeech, loadVoiceStyle } from './supertonic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3100;
const API_SECRET = process.env.TTS_API_SECRET || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://www.yuryprimakov.com,https://yuryprimakov.com').split(',');

const MODELS_DIR = path.join(__dirname, 'models');
const ONNX_DIR = path.join(MODELS_DIR, 'onnx');
const VOICE_DIR = path.join(MODELS_DIR, 'voice_styles');

const VALID_VOICES = ['M1','M2','M3','M4','M5','F1','F2','F3','F4','F5'];
const TOTAL_STEPS = 4;
const SPEED = 1.05;

// ─── WAV encoding ────────────────────────────────────────────────────────────
function float32ToWav(audioData, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = audioData.length * bitsPerSample / 8;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]));
    buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

// ─── Initialize ──────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'GET'],
}));

app.use(express.json({ limit: '1mb' }));

// Auth middleware (optional shared secret)
app.use((req, res, next) => {
  if (API_SECRET && req.path === '/synthesize') {
    const token = req.headers['x-tts-secret'];
    if (token !== API_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', voices: VALID_VOICES });
});

// ─── TTS Engine ──────────────────────────────────────────────────────────────
let tts = null;
const voiceCache = new Map();

async function init() {
  console.log('Loading Supertonic TTS models...');
  const start = Date.now();
  tts = await loadTextToSpeech(ONNX_DIR, false);
  console.log(`Models loaded in ${((Date.now() - start) / 1000).toFixed(1)}s. Sample rate: ${tts.sampleRate}`);
}

async function getVoice(voiceId) {
  if (voiceCache.has(voiceId)) return voiceCache.get(voiceId);
  const stylePath = path.join(VOICE_DIR, `${voiceId}.json`);
  const style = await loadVoiceStyle([stylePath], false);
  voiceCache.set(voiceId, style);
  return style;
}

// ─── Synthesize endpoint ─────────────────────────────────────────────────────
app.post('/synthesize', async (req, res) => {
  try {
    if (!tts) {
      return res.status(503).json({ error: 'TTS engine not ready' });
    }

    const { text, voice_id = 'M2', lang = 'en' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    if (!VALID_VOICES.includes(voice_id)) {
      return res.status(400).json({ error: `Invalid voice_id. Valid: ${VALID_VOICES.join(', ')}` });
    }

    const start = Date.now();
    const style = await getVoice(voice_id);
    const { wav, duration } = await tts.call(text, lang, style, TOTAL_STEPS, SPEED);
    const wavBuffer = float32ToWav(wav, tts.sampleRate);
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);

    console.log(`[TTS] "${text.slice(0, 50)}..." voice=${voice_id} duration=${duration[0].toFixed(1)}s generated=${elapsed}s`);

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': String(wavBuffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(wavBuffer);
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    res.status(500).json({ error: err.message || 'Synthesis failed' });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
init().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TTS service listening on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize TTS:', err);
  process.exit(1);
});
