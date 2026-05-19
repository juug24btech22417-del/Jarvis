const WebSocket = require('ws');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '.env.local') });

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = 'erXw9S1p2m7sptVb04o8'; // Antoni (Standard System Voice)
const MODEL_ID = 'eleven_multilingual_v2';

if (!ELEVENLABS_API_KEY) {
  console.error('[TTS Server] ERROR: ELEVENLABS_API_KEY is missing in .env.local');
  process.exit(1);
}

// Voice Cache
let cachedVoiceId = VOICE_ID;
let voicesFetched = false;

const wss = new WebSocket.Server({ port: 8787, host: '0.0.0.0' });

console.log('[TTS Server] Listening on ws://localhost:8787');

async function getBestVoice() {
  if (voicesFetched) return cachedVoiceId;
  try {
    const vResponse = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    const vData = await vResponse.json();
    if (vData.voices && vData.voices.length > 0) {
      const hasPreferred = vData.voices.some(v => v.voice_id === VOICE_ID);
      if (!hasPreferred) cachedVoiceId = vData.voices[0].voice_id;
    }
    voicesFetched = true;
  } catch (e) {
    console.error('[TTS Server] Voice fetch failed:', e.message);
  }
  return cachedVoiceId;
}

wss.on('connection', (clientWs) => {
  let elWs = null;

  const closeElevenLabs = () => {
    if (elWs) {
      if (elWs.readyState === WebSocket.OPEN) {
        elWs.send(JSON.stringify({ text: "" })); // EOS
      }
      elWs.close();
      elWs = null;
    }
  };

  clientWs.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Handle full speech request (legacy support)
      if (data.type === 'speak') {
        closeElevenLabs();
        const currentVoiceId = await getBestVoice();
        elWs = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${currentVoiceId}/stream-input?model_id=${MODEL_ID}&output_format=pcm_24000`, {
          headers: { 'xi-api-key': ELEVENLABS_API_KEY }
        });

        elWs.on('open', () => {
          elWs.send(JSON.stringify({ text: " ", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }));
          elWs.send(JSON.stringify({ text: data.text + " ", try_trigger_generation: true }));
          elWs.send(JSON.stringify({ text: "" }));
        });

        elWs.on('message', (ev) => {
          const resp = JSON.parse(ev);
          if (resp.audio && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(Buffer.from(resp.audio, 'base64'));
          }
        });
      } 
      
      // Handle streaming chunks (New high-speed mode)
      else if (data.type === 'start_stream') {
        closeElevenLabs();
        const currentVoiceId = await getBestVoice();
        elWs = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${currentVoiceId}/stream-input?model_id=${MODEL_ID}&output_format=pcm_24000`, {
          headers: { 'xi-api-key': ELEVENLABS_API_KEY }
        });

        elWs.on('open', () => {
          elWs.send(JSON.stringify({ text: " ", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }));
          console.log('[TTS Server] ⚡ Stream started');
        });

        elWs.on('message', (ev) => {
          const resp = JSON.parse(ev);
          if (resp.audio && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(Buffer.from(resp.audio, 'base64'));
          }
        });
      } 
      
      else if (data.type === 'chunk') {
        if (elWs && elWs.readyState === WebSocket.OPEN) {
          elWs.send(JSON.stringify({ text: data.text + " ", try_trigger_generation: true }));
        }
      } 
      
      else if (data.type === 'end_stream') {
        if (elWs && elWs.readyState === WebSocket.OPEN) {
          elWs.send(JSON.stringify({ text: "" }));
        }
      } 
      
      else if (data.type === 'cancel') {
        closeElevenLabs();
      }
    } catch (err) {
      console.error('[TTS Server] Error:', err.message);
    }
  });

  clientWs.on('close', () => closeElevenLabs());
});


