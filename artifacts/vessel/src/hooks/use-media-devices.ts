import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY_CAMERA = "vessel_selected_camera";
const STORAGE_KEY_MIC = "vessel_selected_mic";

export type MediaDevice = {
  deviceId: string;
  label: string;
  kind: "videoinput" | "audioinput";
};

export type UseMediaDevicesResult = {
  cameras: MediaDevice[];
  microphones: MediaDevice[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  setSelectedCameraId: (id: string | null) => void;
  setSelectedMicId: (id: string | null) => void;
  refresh: () => Promise<void>;
  permissionError: string | null;
};

export function useMediaDevices(): UseMediaDevicesResult {
  const [cameras, setCameras] = useState<MediaDevice[]>([]);
  const [microphones, setMicrophones] = useState<MediaDevice[]>([]);
  const [selectedCameraId, setSelectedCameraIdState] = useState<string | null>(null);
  const [selectedMicId, setSelectedMicIdState] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const enumerate = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams: MediaDevice[] = [];
      const mics: MediaDevice[] = [];
      for (const d of devices) {
        if (d.kind === "videoinput") {
          cams.push({ deviceId: d.deviceId, label: d.label || "Camera", kind: "videoinput" });
        } else if (d.kind === "audioinput") {
          mics.push({ deviceId: d.deviceId, label: d.label || "Microphone", kind: "audioinput" });
        }
      }
      setCameras(cams);
      setMicrophones(mics);

      const storedCam = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY_CAMERA) : null;
      const storedMic = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY_MIC) : null;

      setSelectedCameraIdState((current) => {
        if (current && cams.some((c) => c.deviceId === current)) return current;
        if (storedCam && cams.some((c) => c.deviceId === storedCam)) return storedCam;
        return cams[0]?.deviceId ?? null;
      });
      setSelectedMicIdState((current) => {
        if (current && mics.some((m) => m.deviceId === current)) return current;
        if (storedMic && mics.some((m) => m.deviceId === storedMic)) return storedMic;
        return mics[0]?.deviceId ?? null;
      });
    } catch (err) {
      console.error("Failed to enumerate devices", err);
    }
  }, []);

  useEffect(() => {
    enumerate();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) return;
    const handler = () => enumerate();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [enumerate]);

  const setSelectedCameraId = useCallback((id: string | null) => {
    setSelectedCameraIdState(id);
    if (typeof localStorage !== "undefined") {
      if (id) localStorage.setItem(STORAGE_KEY_CAMERA, id);
      else localStorage.removeItem(STORAGE_KEY_CAMERA);
    }
  }, []);

  const setSelectedMicId = useCallback((id: string | null) => {
    setSelectedMicIdState(id);
    if (typeof localStorage !== "undefined") {
      if (id) localStorage.setItem(STORAGE_KEY_MIC, id);
      else localStorage.removeItem(STORAGE_KEY_MIC);
    }
  }, []);

  return {
    cameras,
    microphones,
    selectedCameraId,
    selectedMicId,
    setSelectedCameraId,
    setSelectedMicId,
    refresh: enumerate,
    permissionError,
  };
}

export type UseLocalStreamArgs = {
  cameraId: string | null;
  micId: string | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
};

export type UseLocalStreamResult = {
  stream: MediaStream | null;
  error: string | null;
  isLoading: boolean;
  hasPermission: boolean;
};

export function useLocalStream({
  cameraId,
  micId,
  cameraEnabled,
  micEnabled,
}: UseLocalStreamArgs): UseLocalStreamResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const currentStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera and microphone are not supported in this browser.");
      setIsLoading(false);
      return;
    }

    const constraints: MediaStreamConstraints = {
      audio: micId ? { deviceId: { exact: micId } } : true,
      video: cameraId ? { deviceId: { exact: cameraId }, width: 1280, height: 720 } : { width: 1280, height: 720 },
    };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        if (currentStreamRef.current) {
          currentStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        currentStreamRef.current = s;
        setStream(s);
        setHasPermission(true);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("getUserMedia failed", err);
        const name = err?.name || "";
        let msg: string;
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          msg = "Camera and microphone access was blocked. Please allow access in your browser settings.";
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          msg = "No camera or microphone was found on your device.";
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          msg = "Your camera or microphone is being used by another app.";
        } else {
          msg = "Could not access your camera or microphone.";
        }
        setError(msg);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cameraId, micId]);

  useEffect(() => {
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = micEnabled;
    });
  }, [stream, micEnabled]);

  useEffect(() => {
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = cameraEnabled;
    });
  }, [stream, cameraEnabled]);

  useEffect(() => {
    return () => {
      if (currentStreamRef.current) {
        currentStreamRef.current.getTracks().forEach((t) => t.stop());
        currentStreamRef.current = null;
      }
    };
  }, []);

  return { stream, error, isLoading, hasPermission };
}
