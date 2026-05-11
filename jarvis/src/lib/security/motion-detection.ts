// Motion Detection using TensorFlow.js and Webcam
// Detects movement and captures screenshots when motion is detected

export interface MotionDetectionConfig {
  sensitivity: number; // 0-100, threshold for motion detection
  cooldownMs: number; // Minimum time between detections
  captureOnMotion: boolean;
  notifyOnMotion: boolean;
}

export interface MotionEvent {
  timestamp: number;
  screenshot?: string; // Base64 image
  confidence: number; // 0-1 motion confidence
}

class MotionDetector {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private previousFrame: ImageData | null = null;
  private isRunning: boolean = false;
  private config: MotionDetectionConfig;
  private lastMotionTime: number = 0;
  private onMotionCallback?: (event: MotionEvent) => void;
  private animationFrame: number | null = null;

  constructor(config: Partial<MotionDetectionConfig> = {}) {
    this.config = {
      sensitivity: config.sensitivity ?? 30,
      cooldownMs: config.cooldownMs ?? 5000,
      captureOnMotion: config.captureOnMotion ?? true,
      notifyOnMotion: config.notifyOnMotion ?? true,
    };
  }

  // Initialize webcam
  async initialize(): Promise<boolean> {
    try {
      // Create video element (hidden)
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', 'true');
      this.video.style.display = 'none';

      // Create canvas for frame processing
      this.canvas = document.createElement('canvas');

      // Request webcam access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });

      this.video.srcObject = stream;
      await new Promise<void>((resolve) => {
        this.video!.onloadedmetadata = () => {
          this.video!.play();
          resolve();
        };
      });

      // Set canvas size to match video
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;

      console.log('[MotionDetector] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[MotionDetector] Initialization failed:', error);
      return false;
    }
  }

  // Start motion detection
  start(onMotion?: (event: MotionEvent) => void): void {
    if (this.isRunning || !this.video) return;

    this.isRunning = true;
    this.onMotionCallback = onMotion;
    this.detectMotion();
    console.log('[MotionDetector] Started');
  }

  // Stop motion detection
  stop(): void {
    this.isRunning = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    console.log('[MotionDetector] Stopped');
  }

  // Cleanup resources
  destroy(): void {
    this.stop();
    if (this.video && this.video.srcObject) {
      const tracks = (this.video.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      this.video.srcObject = null;
    }
    this.video = null;
    this.canvas = null;
    this.previousFrame = null;
  }

  // Update configuration
  setConfig(config: Partial<MotionDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Main motion detection loop
  private detectMotion(): void {
    if (!this.isRunning || !this.video || !this.canvas) return;

    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Draw current video frame to canvas
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    const currentFrame = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    if (this.previousFrame) {
      // Compare frames
      const motionScore = this.compareFrames(this.previousFrame, currentFrame);
      const threshold = (100 - this.config.sensitivity) / 100;

      if (motionScore > threshold) {
        const now = Date.now();

        // Check cooldown
        if (now - this.lastMotionTime > this.config.cooldownMs) {
          this.lastMotionTime = now;

          const event: MotionEvent = {
            timestamp: now,
            confidence: motionScore,
          };

          // Capture screenshot if enabled
          if (this.config.captureOnMotion) {
            event.screenshot = this.canvas.toDataURL('image/jpeg', 0.7);
          }

          console.log('[MotionDetector] Motion detected!', motionScore.toFixed(2));

          // Call callback
          if (this.onMotionCallback) {
            this.onMotionCallback(event);
          }
        }
      }
    }

    this.previousFrame = currentFrame;
    this.animationFrame = requestAnimationFrame(() => this.detectMotion());
  }

  // Compare two frames and return motion score (0-1)
  private compareFrames(frame1: ImageData, frame2: ImageData): number {
    const data1 = frame1.data;
    const data2 = frame2.data;
    const length = data1.length;

    let diff = 0;
    let pixels = 0;

    // Sample every 4th pixel for performance (RGBA -> check only R channel)
    for (let i = 0; i < length; i += 16) {
      const gray1 = data1[i] * 0.299 + data1[i + 1] * 0.587 + data1[i + 2] * 0.114;
      const gray2 = data2[i] * 0.299 + data2[i + 1] * 0.587 + data2[i + 2] * 0.114;

      if (Math.abs(gray1 - gray2) > 30) {
        diff++;
      }
      pixels++;
    }

    return diff / pixels;
  }

  // Get current video frame as screenshot
  captureFrame(): string | null {
    if (!this.canvas || !this.video) return null;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return this.canvas.toDataURL('image/jpeg', 0.8);
  }
}

// Singleton instance
let motionDetector: MotionDetector | null = null;

export function getMotionDetector(): MotionDetector {
  if (!motionDetector) {
    motionDetector = new MotionDetector();
  }
  return motionDetector;
}

export function initializeMotionDetection(config: Partial<MotionDetectionConfig> = {}): Promise<boolean> {
  const detector = getMotionDetector();
  detector.setConfig(config);
  return detector.initialize();
}

export function startMotionDetection(onMotion?: (event: MotionEvent) => void): void {
  const detector = getMotionDetector();
  detector.start(onMotion);
}

export function stopMotionDetection(): void {
  const detector = getMotionDetector();
  detector.stop();
}

export function destroyMotionDetection(): void {
  const detector = getMotionDetector();
  detector.destroy();
  motionDetector = null;
}

export function captureScreenshot(): string | null {
  const detector = getMotionDetector();
  return detector.captureFrame();
}
