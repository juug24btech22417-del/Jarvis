import { useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { useJarvisStore } from "@/store/jarvis.store";
import { useTextToSpeech } from "./useVoice";

const MODEL_URL = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/";
const FACE_DETECTION_THRESHOLD = 0.6;
const GREETING_COOLDOWN = 10 * 60 * 1000; // 10 minutes between greetings

export function useJarvisBiometrics() {
  const { biometricActive, state } = useJarvisStore();
  const { speak } = useTextToSpeech();
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastGreetingRef = useRef<number>(0);
  const isGreetingRef = useRef(false);

  // Load models
  useEffect(() => {
    if (!biometricActive) return;

    const loadModels = async () => {
      try {
        console.log("[Biometrics] Loading face detection models...");
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        console.log("[Biometrics] Models loaded successfully.");
        setModelsLoaded(true);
      } catch (error) {
        console.error("[Biometrics] Failed to load models:", error);
      }
    };

    loadModels();
  }, [biometricActive]);

  // Start video stream and detection loop
  useEffect(() => {
    if (!biometricActive || !modelsLoaded) return;

    let stream: MediaStream | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        const video = document.createElement("video");
        video.srcObject = stream;
        video.play();
        videoRef.current = video;

        interval = setInterval(async () => {
          if (state !== "idle" || isGreetingRef.current) return;

          const detections = await faceapi.detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions()
          );

          if (detections.length > 0) {
            const now = Date.now();
            if (now - lastGreetingRef.current > GREETING_COOLDOWN) {
              console.log("[Biometrics] Face detected! Triggering greeting.");
              isGreetingRef.current = true;
              lastGreetingRef.current = now;
              
              speak("Welcome back, Boss. All systems are nominal and ready for your command.");
              
              // Reset greeting flag after speech starts
              setTimeout(() => {
                isGreetingRef.current = false;
              }, 5000);
            }
          }
        }, 3000); // Check every 3 seconds
      } catch (error) {
        console.error("[Biometrics] Camera access failed:", error);
      }
    };

    startCamera();

    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (interval) clearInterval(interval);
    };
  }, [biometricActive, modelsLoaded, state, speak]);
}
