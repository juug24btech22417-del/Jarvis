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

const wss = new WebSocket.Server({ port: 8787, host: '0.0.0.0' });

console.log('[TTS Server] Listening on ws://localhost:8787');

wss.on('connection', (clientWs, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[TTS Server] Client connected from ${ip}`);
  
  let elWs = null;

  clientWs.on('error', (err) => {
    console.error('[TTS Server] Client WebSocket Error:', err.message);
  });

  clientWs.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'speak') {
        const text = data.text;
        console.log(`[TTS Server] Speaking: "${text.substring(0, 50)}..."`);

        // Close existing connection if any
        if (elWs) {
          elWs.close();
        }

        // Connect to ElevenLabs WebSocket
        let currentVoiceId = VOICE_ID;
        try {
          console.log('[TTS Server] Fetching available voices...');
          const vResponse = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': ELEVENLABS_API_KEY }
          });
          const vData = await vResponse.json();
          console.log('[TTS Server] Voices API response:', JSON.stringify(vData).substring(0, 200));
          if (vData.voices && vData.voices.length > 0) {
            // Check if our preferred voice is in the list, otherwise use the first one
            const hasPreferred = vData.voices.some(v => v.voice_id === VOICE_ID);
            if (!hasPreferred) {
              currentVoiceId = vData.voices[0].voice_id;
              console.log(`[TTS Server] Preferred voice not found. Using first available: ${vData.voices[0].name} (${currentVoiceId})`);
            }
          } else {
            console.warn('[TTS Server] No voices found in your library.');
          }
        } catch (e) {
          console.error('[TTS Server] Failed to fetch voices, attempting default:', e.message);
        }

        const elUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${currentVoiceId}/stream-input?model_id=${MODEL_ID}&output_format=pcm_24000`;
        console.log(`[TTS Server] Connecting to ElevenLabs (${currentVoiceId})...`);
        elWs = new WebSocket(elUrl, {
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY
          }
        });

        elWs.on('open', () => {
          console.log('[TTS Server] ElevenLabs connection opened');
          // Send initial setup
          elWs.send(JSON.stringify({
            text: ' ', 
            voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          }));

          // Send the actual text
          elWs.send(JSON.stringify({
            text: text + ' ', 
            try_trigger_generation: true,
          }));

          // Send EOS
          elWs.send(JSON.stringify({ text: '' }));
        });

        elWs.on('message', (ev) => {
          try {
            const response = JSON.parse(ev);
            
            if (response.audio) {
              const audioBuffer = Buffer.from(response.audio, 'base64');
              console.log(`[TTS Server] Received audio chunk: ${audioBuffer.length} bytes`);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(audioBuffer);
              }
            }
            
            if (response.error) {
              console.error('[TTS Server] ElevenLabs Error:', response.message || response.error);
              clientWs.send(JSON.stringify({ type: 'error', message: response.message || response.error }));
            }

            if (response.isFinal) {
              console.log('[TTS Server] Generation complete');
            }
          } catch (e) {
            console.error('[TTS Server] Error parsing ElevenLabs response:', e.message);
          }
        });

        elWs.on('error', (err) => {
          console.error('[TTS Server] ElevenLabs Error:', err.message);
          clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
        });

        elWs.on('close', () => {
          elWs = null;
        });

      } else if (data.type === 'cancel') {
        console.log('[TTS Server] Cancellation requested');
        if (elWs) {
          elWs.close();
          elWs = null;
        }
      }
    } catch (err) {
      console.error('[TTS Server] Parse Error:', err.message);
    }
  });

  clientWs.on('close', () => {
    console.log('[TTS Server] Client disconnected');
    if (elWs) elWs.close();
  });
});
