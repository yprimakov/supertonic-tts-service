import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadTextToSpeech, loadVoiceStyle } from './supertonic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3100;
const API_SECRET = process.env.TTS_API_SECRET || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://www.yuryprimakov.com,https://yuryprimakov.com').split(',');

// ─── Supertonic config ───────────────────────────────────────────────────────
const MODELS_DIR = path.join(__dirname, 'models');
const ONNX_DIR = path.join(MODELS_DIR, 'onnx');
const VOICE_DIR = path.join(MODELS_DIR, 'voice_styles');

const SUPERTONIC_VOICES = ['M1','M2','M3','M4','M5','F1','F2','F3','F4','F5'];
const TOTAL_STEPS = 4;
const SPEED = 1.05;

// ─── Kokoro config ───────────────────────────────────────────────────────────
const KOKORO_VOICES = [
  // American English - Female
  'af_heart', 'af_bella', 'af_jessica', 'af_nicole', 'af_sarah', 'af_sky',
  'af_alloy', 'af_aoede', 'af_kore', 'af_nova', 'af_river',
  // American English - Male
  'am_adam', 'am_michael', 'am_echo', 'am_eric', 'am_fenrir',
  'am_liam', 'am_onyx', 'am_puck', 'am_santa',
  // British English - Female
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  // British English - Male
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
  // Japanese
  'jf_alpha', 'jf_beta', 'jf_gama', 'jf_delta', 'jm_epsilon',
  // Mandarin Chinese
  'zf_xiaobei', 'zf_yunjian', 'zm_guangwei', 'zm_yifei',
  // Spanish
  'ef_dora', 'em_alex',
  // French
  'ff_siwis',
  // Hindi
  'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
  // Italian
  'if_sara', 'im_nicola',
  // Brazilian Portuguese
  'pf_dora', 'pm_alex',
];

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

// ─── Express setup ───────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'GET'],
}));

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (API_SECRET && req.path === '/synthesize') {
    const token = req.headers['x-tts-secret'];
    if (token !== API_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
});

// ─── Supertonic Engine ───────────────────────────────────────────────────────
let supertonicTts = null;
const supertonicVoiceCache = new Map();

async function initSupertonic() {
  console.log('[Supertonic] Loading models...');
  const start = Date.now();
  supertonicTts = await loadTextToSpeech(ONNX_DIR, false);
  console.log(`[Supertonic] Ready in ${((Date.now() - start) / 1000).toFixed(1)}s. Sample rate: ${supertonicTts.sampleRate}`);
}

async function getSupertonicVoice(voiceId) {
  if (supertonicVoiceCache.has(voiceId)) return supertonicVoiceCache.get(voiceId);
  const stylePath = path.join(VOICE_DIR, `${voiceId}.json`);
  const style = await loadVoiceStyle([stylePath], false);
  supertonicVoiceCache.set(voiceId, style);
  return style;
}

async function synthesizeSupertonic(text, voiceId, lang) {
  if (!supertonicTts) throw new Error('Supertonic not initialized');
  if (!SUPERTONIC_VOICES.includes(voiceId)) {
    throw new Error(`Invalid Supertonic voice. Valid: ${SUPERTONIC_VOICES.join(', ')}`);
  }
  const style = await getSupertonicVoice(voiceId);
  const { wav, duration } = await supertonicTts.call(text, lang, style, TOTAL_STEPS, SPEED);
  return { wavBuffer: float32ToWav(wav, supertonicTts.sampleRate), duration: duration[0] };
}

// ─── Kokoro Engine ───────────────────────────────────────────────────────────
let kokoroTts = null;

async function initKokoro() {
  console.log('[Kokoro] Loading model (q8, first request may download ~92MB)...');
  const start = Date.now();
  const { KokoroTTS } = await import('kokoro-js');
  kokoroTts = await KokoroTTS.from_pretrained(
    'onnx-community/Kokoro-82M-v1.0-ONNX',
    { dtype: 'q8', device: 'cpu' }
  );
  console.log(`[Kokoro] Ready in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function synthesizeKokoro(text, voiceId) {
  if (!kokoroTts) throw new Error('Kokoro not initialized');
  if (!KOKORO_VOICES.includes(voiceId)) {
    throw new Error(`Invalid Kokoro voice. Valid: ${KOKORO_VOICES.join(', ')}`);
  }
  const audio = await kokoroTts.generate(text, { voice: voiceId });
  // audio.data is Float32Array, audio.sampling_rate is the sample rate
  const wavBuffer = float32ToWav(Array.from(audio.data), audio.sampling_rate);
  const duration = audio.data.length / audio.sampling_rate;
  return { wavBuffer, duration };
}

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    engines: {
      supertonic: {
        ready: !!supertonicTts,
        voices: SUPERTONIC_VOICES,
      },
      kokoro: {
        ready: !!kokoroTts,
        voices: KOKORO_VOICES,
      },
    },
  });
});

// ─── Synthesize endpoint ─────────────────────────────────────────────────────
app.post('/synthesize', async (req, res) => {
  try {
    const { text, engine = 'supertonic', voice_id, lang = 'en' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    const start = Date.now();
    let result;

    if (engine === 'kokoro') {
      const vid = voice_id || 'af_heart';
      result = await synthesizeKokoro(text, vid);
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`[Kokoro] "${text.slice(0, 50)}..." voice=${vid} duration=${result.duration.toFixed(1)}s generated=${elapsed}s`);
    } else {
      const vid = voice_id || 'M2';
      result = await synthesizeSupertonic(text, vid, lang);
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`[Supertonic] "${text.slice(0, 50)}..." voice=${vid} duration=${result.duration.toFixed(1)}s generated=${elapsed}s`);
    }

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': String(result.wavBuffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(result.wavBuffer);
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    res.status(500).json({ error: err.message || 'Synthesis failed' });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
async function start() {
  // Initialize both engines in parallel
  const results = await Promise.allSettled([initSupertonic(), initKokoro()]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[Init] Engine ${i === 0 ? 'Supertonic' : 'Kokoro'} failed:`, r.reason?.message);
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TTS service listening on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
