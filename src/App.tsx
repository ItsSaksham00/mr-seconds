
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";

import {
  Box3,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";

import "./App.css";

// ==========================================
// MR. SECONDS V2.5
// GEMINI AI + AZURE DUSTIN + LIP SYNC
// ==========================================

const MODEL_PATH = "/models/MrSeconds.glb";

const FACE_PATHS = [
  "/textures/face_normal.png",
  "/textures/face_blink.png",
];

type Viseme = {
  timeMs: number;
  id: number;
};

type SpeechResult = {
  audioBase64: string;
  mimeType: string;
  voice: string;
  visemes: Viseme[];
};

type Playback = {
  audio: HTMLAudioElement;
  visemes: Viseme[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type MouthPose = {
  width: number;
  height: number;
  round: number;
  teeth: number;
  tongue: number;
};

type PoseName =
  | "rest"
  | "closed"
  | "small"
  | "ah"
  | "oh"
  | "ee"
  | "oo";

const POSES: Record<PoseName, MouthPose> = {
  rest:   { width: 220, height: 0, round: 0, teeth: 0, tongue: 0 },
  closed: { width: 174, height: 3, round: 0, teeth: 0, tongue: 0 },
  small:  { width: 145, height: 38, round: 0.3, teeth: 0, tongue: 0.3 },
  ah:     { width: 185, height: 118, round: 0.65, teeth: 0.55, tongue: 0.9 },
  oh:     { width: 114, height: 122, round: 1, teeth: 0, tongue: 0.5 },
  ee:     { width: 220, height: 48, round: 0, teeth: 0.85, tongue: 0.2 },
  oo:     { width: 86, height: 83, round: 1, teeth: 0, tongue: 0.25 },
};

function clamp(value: number, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function lerp(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

function smooth(amount: number) {
  const t = clamp(amount);
  return t * t * (3 - 2 * t);
}

function mixPose(
  a: MouthPose,
  b: MouthPose,
  t: number
): MouthPose {
  return {
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
    round: lerp(a.round, b.round, t),
    teeth: lerp(a.teeth, b.teeth, t),
    tongue: lerp(a.tongue, b.tongue, t),
  };
}

function normalizeName(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function findNamedObject(root: Object3D, name: string) {
  const wanted = normalizeName(name);
  let match: Object3D | undefined;

  root.traverse((obj) => {
    if (!match && normalizeName(obj.name).includes(wanted)) {
      match = obj;
    }
  });

  return match;
}

// ==========================================
// AZURE VISEME → MOUTH SHAPE
// ==========================================

function poseFromViseme(id: number): PoseName {
  switch (id) {
    case 0:
      return "rest";

    case 1:
    case 2:
      return "ah";

    case 3:
    case 8:
    case 10:
      return "oh";

    case 4:
    case 5:
    case 9:
      return "small";

    case 6:
    case 11:
      return "ee";

    case 7:
      return "oo";

    case 21:
      return "closed";

    case 18:
      return "ee";

    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 19:
    case 20:
      return "small";

    default:
      return "rest";
  }
}

function getCurrentViseme(
  visemes: Viseme[],
  timeMs: number
): number {
  let left = 0;
  let right = visemes.length - 1;
  let id = 0;

  while (left <= right) {
    const middle = (left + right) >> 1;

    if (visemes[middle].timeMs <= timeMs) {
      id = visemes[middle].id;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  return id;
}

// ==========================================
// PROCEDURAL MOUTH DRAWING
// ==========================================

function drawMouth(
  ctx: CanvasRenderingContext2D,
  pose: MouthPose
) {
  const cx = 512;
  const cy = 700;

  const w = pose.width;
  const h = pose.height;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (h < 9) {
    ctx.strokeStyle = "#292d36";
    ctx.lineWidth = 7;

    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy - 28);
    ctx.quadraticCurveTo(
      cx,
      cy + 32,
      cx + w / 2,
      cy - 28
    );
    ctx.stroke();

    ctx.restore();
    return;
  }

  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;

  const upperCurve = lerp(
    h * 0.18,
    h * 0.47,
    pose.round
  );

  ctx.fillStyle = "#252a33";
  ctx.strokeStyle = "#242831";
  ctx.lineWidth = 5;

  ctx.beginPath();
  ctx.moveTo(left, cy - h * 0.08);

  ctx.bezierCurveTo(
    left + w * 0.1,
    top + upperCurve,
    right - w * 0.1,
    top + upperCurve,
    right,
    cy - h * 0.08
  );

  ctx.bezierCurveTo(
    right - w * 0.08,
    bottom,
    left + w * 0.08,
    bottom,
    left,
    cy - h * 0.08
  );

  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (pose.teeth > 0.08 && h > 22) {
    ctx.fillStyle = "#fff5e8";
    ctx.beginPath();
    ctx.ellipse(
      cx,
      top + h * 0.22,
      w * 0.32,
      Math.max(1, Math.min(h * 0.18, 15) * pose.teeth),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  if (pose.tongue > 0.08 && h > 20) {
    ctx.fillStyle = "#ec7382";
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy + h * 0.27,
      Math.max(2, w * 0.3 * pose.tongue),
      Math.max(2, h * 0.13 * pose.tongue),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.restore();
}

// ==========================================
// ANIMATED FACE TEXTURE
// ==========================================

function createFaceAnimator(
  normal: HTMLImageElement,
  blink: HTMLImageElement
) {
  const canvas = document.createElement("canvas");

  canvas.width = normal.naturalWidth;
  canvas.height = normal.naturalHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Cannot create face canvas.");
  }

  const ctx: CanvasRenderingContext2D = context;

  const sx = canvas.width / 1024;
  const sy = canvas.height / 1024;

  function paint(
    blinking: boolean,
    pose: MouthPose,
    talking: boolean
  ) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(
      normal,
      0,
      0,
      canvas.width,
      canvas.height
    );

    if (blinking) {
      const x = 215 * sx;
      const y = 165 * sy;
      const w = 590 * sx;
      const h = 430 * sy;

      ctx.clearRect(x, y, w, h);

      ctx.drawImage(
        blink,
        x, y, w, h,
        x, y, w, h
      );
    }

    if (talking) {
      ctx.clearRect(
        330 * sx,
        605 * sy,
        370 * sx,
        210 * sy
      );

      ctx.save();
      ctx.scale(sx, sy);
      drawMouth(ctx, pose);
      ctx.restore();
    }

    ctx.restore();
  }

  paint(false, POSES.rest, false);

  const texture = new CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  return {
    texture,

    update(
      blinking: boolean,
      pose: MouthPose,
      talking: boolean
    ) {
      paint(blinking, pose, talking);
      texture.needsUpdate = true;
    },

    dispose() {
      texture.dispose();
    },
  };
}

// ==========================================
// WAVE ANIMATION
// ==========================================

const WAVE_KEYS: [number, number][] = [
  [0, 0],
  [0.35, 60],
  [0.6, 43],
  [0.85, 68],
  [1.1, 43],
  [1.35, 65],
  [1.85, 0],
];

function getWaveAngle(time: number) {
  if (time <= 0 || time >= 1.85) return 0;

  for (let i = 0; i < WAVE_KEYS.length - 1; i++) {
    const [t1, a1] = WAVE_KEYS[i];
    const [t2, a2] = WAVE_KEYS[i + 1];

    if (time >= t1 && time <= t2) {
      const p = smooth((time - t1) / (t2 - t1));

      return (
        ((a1 + (a2 - a1) * p) * Math.PI) / 180
      );
    }
  }

  return 0;
}

// ==========================================
// 3D MODEL
// ==========================================

function MrSecondsModel({
  waveRequest,
  playbackRef,
}: {
  waveRequest: number;
  playbackRef: RefObject<Playback | null>;
}) {
  const { scene } = useGLTF(MODEL_PATH);

  const [normal, blink] = useLoader(
    TextureLoader,
    FACE_PATHS
  );

  const idleRef = useRef<Group>(null);
  const waveTime = useRef(10);
  const previousWave = useRef(waveRequest);

  const currentPose = useRef<MouthPose>({
    ...POSES.rest,
  });

  const refreshTime = useRef(0);
  const lastBlink = useRef(false);
  const lastTalking = useRef(false);

  const model = useMemo(() => {
    const root = scene.clone(true);

    root.updateMatrixWorld(true);

    const bounds = new Box3().setFromObject(root);

    const center = new Vector3();
    const size = new Vector3();

    bounds.getCenter(center);
    bounds.getSize(size);

    const scale =
      4 /
      Math.max(size.x, size.y, size.z, 0.001);

    let waveControl = findNamedObject(
      root,
      "MS_V17_RIGHT_ARM_CONTROL"
    );

    // Use a React pivot if the GLB doesn't
    // contain Blender's wave controller.
    if (!waveControl) {
      const arm = findNamedObject(
        root,
        "ARM R curved"
      );

      if (arm) {
        const armBounds = new Box3().setFromObject(arm);
        const armCenter = new Vector3();

        armBounds.getCenter(armCenter);

        const rightSide = armCenter.x > center.x;

        const shoulder = new Vector3(
          rightSide
            ? armBounds.min.x
            : armBounds.max.x,
          armBounds.max.y,
          armCenter.z
        );

        const pivot = new Group();

        pivot.name = "MS_REACT_WAVE_CONTROL";

        root.add(pivot);
        pivot.position.copy(shoulder);

        root.updateMatrixWorld(true);

        const parts: Object3D[] = [arm];

        root.traverse((obj) => {
          if (
            normalizeName(obj.name).startsWith("GLOVER")
          ) {
            parts.push(obj);
          }
        });

        const partSet = new Set(parts);

        const topLevel = parts.filter((obj) => {
          let parent = obj.parent;

          while (parent) {
            if (partSet.has(parent)) return false;
            parent = parent.parent;
          }

          return true;
        });

        topLevel.forEach((part) => {
          pivot.attach(part);
        });

        waveControl = pivot;
      }
    }

    const faceAnimator = createFaceAnimator(
      normal.image as HTMLImageElement,
      blink.image as HTMLImageElement
    );

    const face = findNamedObject(
      root,
      "FACE ART V1.2"
    );

    const createdMaterials: (
      | MeshBasicMaterial
      | MeshStandardMaterial
    )[] = [];

    if (face) {
      face.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;

        const originals = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];

        const replacements = originals.map((material) => {
          const clone = material.clone();

          if (
            clone instanceof MeshBasicMaterial ||
            clone instanceof MeshStandardMaterial
          ) {
            clone.map = faceAnimator.texture;
            clone.transparent = true;
            clone.needsUpdate = true;

            createdMaterials.push(clone);
          }

          return clone;
        });

        obj.material = Array.isArray(obj.material)
          ? replacements
          : replacements[0];
      });
    } else {
      console.warn("Mr. Seconds face mesh not found.");
    }

    return {
      root,
      center,
      scale,
      waveControl,
      originalRotation: waveControl?.rotation.z ?? 0,
      faceAnimator,
      createdMaterials,
    };
  }, [scene, normal, blink]);

  useEffect(() => {
    return () => {
      model.faceAnimator.dispose();
      model.createdMaterials.forEach((m) => m.dispose());
    };
  }, [model]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);

    if (idleRef.current) {
      idleRef.current.position.y =
        Math.sin(t * 1.6) * 0.09;

      idleRef.current.rotation.z =
        Math.sin(t * 0.9) * 0.035;
    }

    if (previousWave.current !== waveRequest) {
      previousWave.current = waveRequest;
      waveTime.current = 0;
    }

    waveTime.current += dt;

    if (model.waveControl) {
      model.waveControl.rotation.z =
        model.originalRotation +
        getWaveAngle(waveTime.current);
    }

    const cycle = t % 4.8;

    const blinking =
      cycle < 0.14 ||
      (cycle > 0.29 && cycle < 0.36);

    const playback = playbackRef.current;

    const talking = Boolean(
      playback &&
      !playback.audio.paused &&
      !playback.audio.ended
    );

    let target = POSES.rest;

    if (talking && playback) {
      const timeMs =
        playback.audio.currentTime * 1000;

      const id = getCurrentViseme(
        playback.visemes,
        timeMs
      );

      target = POSES[poseFromViseme(id)];
    }

    currentPose.current = mixPose(
      currentPose.current,
      target,
      1 - Math.exp(-(talking ? 24 : 12) * dt)
    );

    refreshTime.current += delta;

    if (
      blinking !== lastBlink.current ||
      talking !== lastTalking.current ||
      refreshTime.current >= 1 / 30
    ) {
      model.faceAnimator.update(
        blinking,
        currentPose.current,
        talking
      );

      lastBlink.current = blinking;
      lastTalking.current = talking;
      refreshTime.current = 0;
    }
  });

  return (
    <group ref={idleRef}>
      <group scale={model.scale}>
        <group
          position={[
            -model.center.x,
            -model.center.y,
            -model.center.z,
          ]}
        >
          <primitive object={model.root} />
        </group>
      </group>
    </group>
  );
}

// ==========================================
// CANVAS VIEWER
// ==========================================

function ModelViewer({
  waveRequest,
  playbackRef,
}: {
  waveRequest: number;
  playbackRef: RefObject<Playback | null>;
}) {
  return (
    <Canvas
      camera={{
        position: [0, 0, 8],
        fov: 35,
        near: 0.01,
        far: 1000,
      }}
      gl={{ antialias: true, alpha: true }}
      style={{
        width: "100%",
        height: "100%",
      }}
    >
      <ambientLight intensity={1.4} />

      <directionalLight
        position={[4, 7, 6]}
        intensity={2.2}
      />

      <Suspense
        fallback={
          <Html center>
            Loading Mr. Seconds...
          </Html>
        }
      >
        <MrSecondsModel
          waveRequest={waveRequest}
          playbackRef={playbackRef}
        />
      </Suspense>

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enablePan={false}
        minDistance={4}
        maxDistance={14}
      />
    </Canvas>
  );
}

// ==========================================
// AUDIO UTILITIES
// ==========================================

function createAudioURL(
  base64: string,
  mimeType: string
) {
  const binary = atob(base64);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], {
    type: mimeType,
  });

  return URL.createObjectURL(blob);
}

// ==========================================
// MAIN APP
// ==========================================

export default function App() {
  const [waveRequest, setWaveRequest] = useState(0);

  const [message, setMessage] = useState("");

  const [chatHistory, setChatHistory] = useState<
    ChatMessage[]
  >([]);

  const [thinking, setThinking] = useState(false);

  const [status, setStatus] = useState<
    "idle" | "loading" | "speaking"
  >("idle");

  const [error, setError] = useState("");
  const [showInfo, setShowInfo] = useState(true);

  const playbackRef = useRef<Playback | null>(null);

  const audioURLRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const busy = thinking || status !== "idle";

  const latestAnswer =
    [...chatHistory]
      .reverse()
      .find((item) => item.role === "assistant")
      ?.content ?? "";

  function cleanupAudio() {
    const playback = playbackRef.current;

    if (playback) {
      const audio = playback.audio;

      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();

      playbackRef.current = null;
    }

    if (audioURLRef.current) {
      URL.revokeObjectURL(audioURLRef.current);
      audioURLRef.current = null;
    }
  }

  function stopSpeaking() {
    requestIdRef.current += 1;

    abortRef.current?.abort();
    abortRef.current = null;

    cleanupAudio();
    setStatus("idle");
  }

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();

      if (playbackRef.current) {
        const audio = playbackRef.current.audio;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }

      if (audioURLRef.current) {
        URL.revokeObjectURL(audioURLRef.current);
      }

      playbackRef.current = null;
      audioURLRef.current = null;
    };
  }, []);

  // ========================================
  // AZURE SPEECH
  // ========================================

  async function speak(textOverride?: string) {
    const text = (textOverride ?? message).trim();

    if (!text) {
      setError("Please enter something to say.");
      return;
    }

    if (text.length > 300) {
      setError(
        "Speech is currently limited to 300 characters."
      );
      return;
    }

    stopSpeaking();

    setError("");
    setStatus("loading");

    const requestId = requestIdRef.current;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Azure Speech request failed: ${response.status}`
        );
      }

      const result =
        (await response.json()) as SpeechResult;

      if (requestId !== requestIdRef.current) return;

      if (
        !result.audioBase64 ||
        !Array.isArray(result.visemes)
      ) {
        throw new Error("Invalid Azure response.");
      }

      const url = createAudioURL(
        result.audioBase64,
        result.mimeType || "audio/wav"
      );

      audioURLRef.current = url;

      const audio = new Audio(url);
      audio.preload = "auto";

      const visemes = [...result.visemes].sort(
        (a, b) => a.timeMs - b.timeMs
      );

      playbackRef.current = { audio, visemes };

      audio.onended = () => {
        if (requestId !== requestIdRef.current) return;
        cleanupAudio();
        setStatus("idle");
      };

      audio.onerror = () => {
        if (requestId !== requestIdRef.current) return;
        cleanupAudio();
        setStatus("idle");
        setError("Audio playback failed.");
      };

      await audio.play();

      if (requestId === requestIdRef.current) {
        setStatus("speaking");
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;

      cleanupAudio();
      setStatus("idle");

      if (
        err instanceof DOMException &&
        err.name === "AbortError"
      ) {
        return;
      }

      const details =
        err instanceof Error
          ? err.message
          : "Unknown audio error";

      setError(details);
      console.error("Azure Speech:", err);
    } finally {
      if (requestId === requestIdRef.current) {
        abortRef.current = null;
      }
    }
  }

  // ========================================
  // GEMINI AI
  // ========================================

  async function askMrSeconds() {
    const question = message.trim();

    if (!question || busy) return;

    setError("");
    setThinking(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: question,
          history: chatHistory.slice(-8),
        }),
      });

      if (!response.ok) {
        const failure = await response
          .json()
          .catch(() => null);

        const explanation =
          typeof failure?.error === "string"
            ? failure.error
            : `Gemini returned HTTP ${response.status}`;

        throw new Error(explanation);
      }

      const data = (await response.json()) as {
        answer?: string;
        model?: string;
      };

      const answer = data.answer?.trim();

      if (!answer) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      setChatHistory((previous) => [
        ...previous.slice(-12),
        {
          role: "user",
          content: question,
        },
        {
          role: "assistant",
          content: answer,
        },
      ]);

      // Clear the question so the user can
      // easily type the next message.
      setMessage("");

      // Reuse the same working Azure
      // speech and lip-sync pipeline.
      if (answer.length <= 300) {
        await speak(answer);
      } else {
        setError(
          "Mr. Seconds answered, but the response " +
          "is too long for the current 300-character " +
          "speech limit."
        );
      }
    } catch (err) {
      console.error("Gemini conversation error:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Couldn't contact Gemini."
      );
    } finally {
      setThinking(false);
    }
  }

  // ========================================
  // INTERFACE
  // ========================================

  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-icon">⏱</div>

          <div>
            <h1>Mr. Seconds</h1>
            <p>Your personal AI companion</p>
          </div>
        </div>

        <span className="version">
          Gemini AI • V2.5
        </span>
      </header>

      <section className="viewer">
        <ModelViewer
          waveRequest={waveRequest}
          playbackRef={playbackRef}
        />

        <div className="animation-controls">
          <div className="control-heading">
            <span className="status-dot" />
            <span>Mr. Seconds</span>
          </div>

          <button
            className="wave-button"
            onClick={() => {
              setWaveRequest((v) => v + 1);
            }}
          >
            👋 Wave Hello
          </button>

          <div className="speech-panel">
            <label
              className="speech-label"
              htmlFor="speech-message"
            >
              Ask Mr. Seconds anything
            </label>

            <textarea
              id="speech-message"
              className="speech-input"
              value={message}
              rows={3}
              maxLength={1000}
              placeholder="Type a question..."
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />

            <button
              className="wave-button talk-button"
              onClick={() => void askMrSeconds()}
              disabled={busy || !message.trim()}
            >
              {thinking
                ? "🧠 Thinking..."
                : "✨ Ask Mr. Seconds"}
            </button>

            <button
              className="wave-button"
              onClick={() => {
                if (status === "idle") {
                  void speak();
                } else {
                  stopSpeaking();
                }
              }}
              disabled={thinking}
            >
              {status === "loading"
                ? "⏹ Cancel Speech"
                : status === "speaking"
                ? "⏹ Stop Speaking"
                : "🔊 Speak Typed Text"}
            </button>

            {latestAnswer && (
              <div
                className="ai-response"
                aria-live="polite"
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 12,
                  background: "rgba(16, 145, 149, 0.08)",
                  border:
                    "1px solid rgba(16, 145, 149, 0.2)",
                  lineHeight: 1.6,
                }}
              >
                <strong>Mr. Seconds says:</strong>

                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  {latestAnswer}
                </p>
              </div>
            )}

            {error && (
              <p
                className="speech-error"
                role="alert"
                style={{ marginTop: 10 }}
              >
                {error}
              </p>
            )}
          </div>

          <div className="control-description">
            {thinking
              ? "Gemini is generating a response..."
              : status === "loading"
              ? "Generating Dustin's speech..."
              : status === "speaking"
              ? "Mr. Seconds is speaking..."
              : "Ready to chat!"}
          </div>
        </div>

        {showInfo && (
          <div className="viewer-info">
            <strong>Meet Mr. Seconds!</strong>
            <p>Drag to rotate · Scroll to zoom</p>

            <button
              onClick={() => setShowInfo(false)}
            >
              Got it!
            </button>
          </div>
        )}
      </section>

      <footer className="footer">
        <span>● Interactive AI companion</span>
        <span>Gemini + Azure • V2.5</span>
      </footer>
    </main>
  );
}

useGLTF.preload(MODEL_PATH);
