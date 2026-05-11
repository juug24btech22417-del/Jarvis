"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Eye,
  Camera,
  Scan,
  Smile,
  Type,
  Upload,
  Loader2,
  Play,
  AlertCircle,
  Check,
  Box,
  Maximize,
} from "lucide-react";

const VISION_TASKS = [
  { id: "object-detection", name: "Object Detection", icon: Box },
  { id: "image-classification", name: "Classify Image", icon: Scan },
  { id: "face-detection", name: "Face Detection", icon: Smile },
  { id: "ocr", name: "Text Recognition", icon: Type },
];

interface DetectedObject {
  label: string;
  confidence: number;
  box: [number, number, number, number];
}

export default function VisionPanel() {
  const [selectedTask, setSelectedTask] = useState("object-detection");
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result as string);
        setResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      console.error("Camera access denied:", err);
    }
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0);
      setImage(canvas.toDataURL("image/png"));
      setCameraActive(false);

      // Stop camera stream
      const stream = video.srcObject as MediaStream;
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  };

  const analyzeImage = async () => {
    if (!image) return;
    setLoading(true);
    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedTask,
          image,
          useExternal: false, // Use browser-based processing
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data);
      }
    } catch (err) {
      console.error("Vision analysis failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-rose-900/20 to-pink-900/20 rounded-2xl border border-rose-500/30 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-rose-500/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
            <Eye className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-rose-400">Vision AI</h3>
            <p className="text-xs text-rose-400/60">Object & Face Recognition</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Task Selector */}
        <div className="grid grid-cols-2 gap-2">
          {VISION_TASKS.map((task) => (
            <button
              key={task.id}
              onClick={() => {
                setSelectedTask(task.id);
                setResult(null);
              }}
              className={`p-2 rounded-lg text-xs font-medium flex flex-col items-center gap-1 transition-all ${
                selectedTask === task.id
                  ? "bg-rose-500 text-white"
                  : "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
              }`}
            >
              <task.icon className="w-4 h-4" />
              <span className="text-center leading-tight">{task.name}</span>
            </button>
          ))}
        </div>

        {/* Image Upload / Camera */}
        <div className="space-y-3">
          {!image ? (
            <div className="border-2 border-dashed border-rose-500/30 rounded-xl p-6 text-center space-y-3">
              {!cameraActive ? (
                <>
                  <Upload className="w-10 h-10 text-rose-400/60 mx-auto" />
                  <p className="text-rose-100/60 text-sm">
                    Drop image or click to upload
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-rose-500 text-white rounded-lg text-sm font-medium hover:bg-rose-400 transition-all"
                    >
                      Upload Image
                    </button>
                    <button
                      onClick={startCamera}
                      className="px-4 py-2 bg-rose-500/20 text-rose-400 rounded-lg text-sm font-medium hover:bg-rose-500/30 transition-all"
                    >
                      <Camera className="w-4 h-4 inline mr-1" />
                      Camera
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </>
              ) : (
                <div className="space-y-3">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full rounded-lg"
                  />
                  <button
                    onClick={captureImage}
                    className="px-6 py-2 bg-rose-500 text-white rounded-lg text-sm font-medium"
                  >
                    Capture
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="relative">
              <img
                src={image}
                alt="Analysis"
                className="w-full rounded-xl border border-rose-500/20"
              />
              {result?.objects?.map((obj: any, idx: number) => (
                <div
                  key={idx}
                  className="absolute border-2 border-rose-400 rounded"
                  style={{
                    left: `${obj.box?.[0]}px`,
                    top: `${obj.box?.[1]}px`,
                    width: `${obj.box?.[2] - obj.box?.[0]}px`,
                    height: `${obj.box?.[3] - obj.box?.[1]}px`,
                  }}
                >
                  <span className="absolute -top-6 left-0 bg-rose-500 text-white text-xs px-2 py-0.5 rounded">
                    {obj.label} ({Math.round(obj.score * 100)}%)
                  </span>
                </div>
              ))}
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={() => {
                    setImage(null);
                    setResult(null);
                  }}
                  className="p-2 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-all"
                >
                  <Maximize className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {image && (
            <button
              onClick={analyzeImage}
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-rose-500 to-pink-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 hover:from-rose-400 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Scan className="w-5 h-5" />
                  Analyze Image
                </>
              )}
            </button>
          )}
        </div>

        {/* Results */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-rose-500/5 rounded-xl p-4 border border-rose-500/20 space-y-3"
          >
            <h5 className="text-sm font-medium text-rose-400">
              Detection Results
            </h5>

            {result.objects?.map((obj: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-rose-500/10 rounded-lg"
              >
                <span className="text-rose-100 capitalize">{obj.label}</span>
                <span className="text-rose-400 text-sm">
                  {Math.round(obj.score * 100)}%
                </span>
              </div>
            ))}

            {result.classifications?.map((cls: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-rose-500/10 rounded-lg"
              >
                <span className="text-rose-100 capitalize">{cls.label}</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-2 bg-rose-500/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full"
                      style={{ width: `${cls.score * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-rose-400 w-8 text-right">
                    {Math.round(cls.score * 100)}%
                  </span>
                </div>
              </div>
            ))}

            {result.text && (
              <div className="p-3 bg-rose-500/10 rounded-lg">
                <p className="text-rose-100/80 text-sm">{result.text}</p>
              </div>
            )}

            {result.mode === "browser" && (
              <div className="flex items-start gap-2 p-3 bg-yellow-500/10 rounded-lg">
                <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-yellow-100/70">
                  Demo mode active. For production, integrate TensorFlow.js
                  or Hugging Face Inference API.
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* Canvas (hidden, for camera capture) */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Info */}
        {!result && (
          <div className="bg-rose-500/5 rounded-xl p-4 border border-rose-500/20">
            <h4 className="text-sm font-medium text-rose-400 mb-3">
              Capabilities
            </h4>
            <div className="space-y-2 text-xs text-rose-100/60">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-rose-400" />
                <span>Detect 80+ object types</span>
              </div>
              <div className="flex items-center gap-2">
                <Smile className="w-4 h-4 text-rose-400" />
                <span>Face detection & analysis</span>
              </div>
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-rose-400" />
                <span>Extract text from images (OCR)</span>
              </div>
            </div>          </div>
        )}
      </div>
    </div>
  );
}
