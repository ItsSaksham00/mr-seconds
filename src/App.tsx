
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";

import {
  Environment,
  Html,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";

import {
  Box3,
  CanvasTexture,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three";

import "./App.css";

// ==================================================
// MR. SECONDS V2.3 — FIRST VOICE
// Browser speech synthesis + approximate lip-sync
// ==================================================

const MODEL_PATH = "/models/MrSeconds.glb";

const FACE_PATHS = [
  "/textures/face_normal.png",
  "/textures/face_blink.png",
];

const EYE_REGION = {
  x: 215,
  y: 165,
  w: 590,
  h: 430,
};

const MOUTH_REGION = {
  x: 330,
  y: 605,
  w: 370,
  h: 210,
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smooth(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function normalizeName(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function findNamedObject(root: Object3D, name: string) {
  const target = normalizeName(name);
  let found: Object3D | undefined;

  root.traverse((object) => {
    if (
      !found &&
      normalizeName(object.name).includes(target)
    ) {
      found = object;
    }
  });

  return found;
}

// ==================================================
// MOUTH SHAPES
// ==================================================

type PoseName =
  | "rest"
  | "closed"
  | "small"
  | "ah"
  | "oh"
  | "ee"
  | "oo";

type MouthPose = {
  width: number;
  height: number;
  round: number;
  teeth: number;
  tongue: number;
};

const POSES: Record<PoseName, MouthPose> = {
  rest: {
    width: 220,
    height: 0,
    round: 0,
    teeth: 0,
    tongue: 0,
  },

  closed: {
    width: 174,
    height: 3,
    round: 0,
    teeth: 0,
    tongue: 0,
  },

  small: {
    width: 145,
    height: 38,
    round: 0.3,
    teeth: 0,
    tongue: 0.3,
  },

  ah: {
    width: 185,
    height: 118,
    round: 0.65,
    teeth: 0.55,
    tongue: 0.9,
  },

  oh: {
    width: 114,
    height: 122,
    round: 1,
    teeth: 0,
    tongue: 0.5,
  },

  ee: {
    width: 220,
    height: 48,
    round: 0,
    teeth: 0.85,
    tongue: 0.2,
  },

  oo: {
    width: 86,
    height: 83,
    round: 1,
    teeth: 0,
    tongue: 0.25,
  },
};

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

// ==================================================
// DRAW THE MOUTH
// ==================================================

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
    // Closed smiling mouth.
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

  // Teeth
  if (pose.teeth > 0.08 && h > 22) {
    ctx.fillStyle = "#fff5e8";

    ctx.beginPath();
    ctx.ellipse(
      cx,
      top + h * 0.22,
      w * 0.32,
      Math.max(
        1,
        Math.min(h * 0.18, 15) * pose.teeth
      ),
      0,
      0,
      Math.PI * 2
    );

    ctx.fill();
  }

  // Tongue
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

// ==================================================
// FACIAL TEXTURE
// ==================================================

function createFaceAnimator(
  normal: HTMLImageElement,
  blink: HTMLImageElement
) {
  const canvas = document.createElement("canvas");

  canvas.width = normal.naturalWidth;
  canvas.height = normal.naturalHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Cannot create facial canvas.");
  }

  const ctx: CanvasRenderingContext2D = context;

  const sx = canvas.width / 1024;
  const sy = canvas.height / 1024;

  function paint(
    blinking: boolean,
    pose: MouthPose,
    customMouth: boolean
  ) {
    ctx.save();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    // Normal face artwork.
    ctx.drawImage(
      normal,
      0,
      0,
      canvas.width,
      canvas.height
    );

    if (blinking) {
      const x = EYE_REGION.x * sx;
      const y = EYE_REGION.y * sy;
      const w = EYE_REGION.w * sx;
      const h = EYE_REGION.h * sy;

      ctx.clearRect(x, y, w, h);

      ctx.drawImage(
        blink,
        x, y, w, h,
        x, y, w, h
      );
    }

    if (customMouth) {
      // Erase existing mouth before drawing a
      // different expression.
      ctx.clearRect(
        MOUTH_REGION.x * sx,
        MOUTH_REGION.y * sy,
        MOUTH_REGION.w * sx,
        MOUTH_REGION.h * sy
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
      customMouth: boolean
    ) {
      paint(blinking, pose, customMouth);
      texture.needsUpdate = true;
    },

    dispose() {
      texture.dispose();
    },
  };
}

// ==================================================
// SPEECH TIMING STATE
// ==================================================

// Browser speech events update this object.
// React Three Fiber reads it during each frame
// without requiring a React re-render.

type SpeechTiming = {
  active: boolean;
  text: string;
  startedAt: number;
  word: string;
  wordStartedAt: number;
  hasBoundary: boolean;
};

function newSpeechTiming(): SpeechTiming {
  return {
    active: false,
    text: "",
    startedAt: 0,
    word: "",
    wordStartedAt: 0,
    hasBoundary: false,
  };
}

// These are approximations from written letters,
// not actual phonemes from the speech engine.

function poseForLetter(letter: string): PoseName {
  const c = letter.toLowerCase();

  if ("mbp".includes(c) && c.length === 1) {
    return "closed";
  }

  if (c === "a") return "ah";
  if (c === "o") return "oh";
  if (c === "u" || c === "w") return "oo";
  if ("eiy".includes(c) && c.length === 1) {
    return "ee";
  }

  if (/^[a-z]$/.test(c)) return "small";

  return "rest";
}

function speechPose(
  speech: SpeechTiming,
  now: number
): PoseName {
  if (!speech.active) return "rest";

  if (speech.hasBoundary && speech.word) {
    const elapsed = Math.max(
      0,
      (now - speech.wordStartedAt) / 1000
    );

    // Approximate 1 letter movement every
    // 120 milliseconds after word starts.
    const index = Math.min(
      speech.word.length - 1,
      Math.floor(elapsed / 0.12)
    );

    const letter = speech.word[index];

    return poseForLetter(letter);
  }

  // Fallback for browsers that do not provide
  // word-boundary events.
  const elapsed = Math.max(
    0,
    (now - speech.startedAt) / 1000
  );

  const index = Math.floor(elapsed * 9);

  const letter = speech.text[
    Math.min(index, speech.text.length - 1)
  ] ?? " ";

  return poseForLetter(letter);
}

// ==================================================
// WAVING — SAME APPROACH AS V2.2
// ==================================================

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
  if (time <= 0 || time >= 1.85) {
    return 0;
  }

  for (let i = 0; i < WAVE_KEYS.length - 1; i++) {
    const [t1, a1] = WAVE_KEYS[i];
    const [t2, a2] = WAVE_KEYS[i + 1];

    if (time >= t1 && time <= t2) {
      const progress = smooth(
        (time - t1) / (t2 - t1)
      );

      return (
        a1 + (a2 - a1) * progress
      ) * Math.PI / 180;
    }
  }

  return 0;
}

// ==================================================
// MR. SECONDS MODEL
// ==================================================

function MrSecondsModel({
  waveRequest,
  speechRef,
}: {
  waveRequest: number;
  speechRef: React.RefObject<SpeechTiming>;
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

  const mouthEnergy = useRef(0);
  const lastActive = useRef(false);
  const refreshTime = useRef(0);
  const lastBlink = useRef(false);

  const model = useMemo(() => {
    const root = scene.clone(true);

    root.updateMatrixWorld(true);

    const bounds = new Box3().setFromObject(root);

    const center = new Vector3();
    const size = new Vector3();

    bounds.getCenter(center);
    bounds.getSize(size);

    const scale = 4 / Math.max(
      size.x,
      size.y,
      size.z,
      0.001
    );

    let waveControl = findNamedObject(
      root,
      "MS_V17_RIGHT_ARM_CONTROL"
    );

    // Fallback if Blender controller was not
    // included in the static GLB.
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
            normalizeName(obj.name).startsWith("GLOVER") &&
            obj !== pivot
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

        for (const part of topLevel) {
          pivot.attach(part);
        }

        waveControl = pivot;
      }
    }

    const faceAnimator = createFaceAnimator(
      normal.image as HTMLImageElement,
      blink.image as HTMLImageElement
    );

    const faceObject = findNamedObject(
      root,
      "FACE ART V1.2"
    );

    const createdMaterials: Material[] = [];

    if (faceObject) {
      faceObject.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;

        const originals = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];

        const replacements = originals.map((mat) => {
          const cloned = mat.clone();

          if (
            cloned instanceof MeshBasicMaterial ||
            cloned instanceof MeshStandardMaterial
          ) {
            cloned.map = faceAnimator.texture;
            cloned.transparent = true;
            cloned.needsUpdate = true;
          }

          createdMaterials.push(cloned);

          return cloned;
        });

        obj.material = Array.isArray(obj.material)
          ? replacements
          : replacements[0];
      });
    } else {
      console.warn(
        "Mr. Seconds face mesh not found."
      );
    }

    return {
      root,
      center,
      scale,
      waveControl,
      originalRotation:
        waveControl?.rotation.z ?? 0,
      faceAnimator,
      createdMaterials,
    };
  }, [scene, normal, blink]);

  useEffect(() => {
    return () => {
      model.faceAnimator.dispose();

      model.createdMaterials.forEach((mat) => {
        mat.dispose();
      });
    };
  }, [model]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // ---------------------------------------
    // IDLE
    // ---------------------------------------

    if (idleRef.current) {
      idleRef.current.position.y =
        Math.sin(t * 1.6) * 0.09;

      idleRef.current.rotation.z =
        Math.sin(t * 0.9) * 0.035;
    }

    // ---------------------------------------
    // WAVING
    // ---------------------------------------

    if (waveRequest !== previousWave.current) {
      previousWave.current = waveRequest;
      waveTime.current = 0;
    }

    waveTime.current += Math.min(delta, 0.1);

    if (model.waveControl) {
      model.waveControl.rotation.z =
        model.originalRotation +
        getWaveAngle(waveTime.current);
    }

    // ---------------------------------------
    // BLINKING
    // ---------------------------------------

    const cycle = t % 4.8;

    const blinking =
      cycle < 0.14 ||
      (cycle > 0.29 && cycle < 0.36);

    // ---------------------------------------
    // SPEECH-DRIVEN MOUTH
    // ---------------------------------------

    const speech = speechRef.current;

    const targetName = speechPose(
      speech,
      performance.now()
    );

    const target = POSES[targetName];

    // Smoothly approach each new mouth shape.
    const factor =
      1 - Math.exp(-13 * Math.min(delta, 0.05));

    currentPose.current = mixPose(
      currentPose.current,
      target,
      factor
    );

    // Fade between custom talking mouth
    // and the original smile as speech ends.
    const energyTarget = speech.active ? 1 : 0;

    mouthEnergy.current = lerp(
      mouthEnergy.current,
      energyTarget,
      1 - Math.exp(-9 * Math.min(delta, 0.05))
    );

    const customMouth =
      speech.active || mouthEnergy.current > 0.025;

    // ---------------------------------------
    // REFRESH FACE TEXTURE
    // ---------------------------------------

    refreshTime.current += delta;

    const activeChanged =
      speech.active !== lastActive.current;

    const blinkChanged =
      blinking !== lastBlink.current;

    if (
      activeChanged ||
      blinkChanged ||
      refreshTime.current >= 1 / 30
    ) {
      model.faceAnimator.update(
        blinking,
        currentPose.current,
        customMouth
      );

      refreshTime.current = 0;
      lastActive.current = speech.active;
      lastBlink.current = blinking;
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

// ==================================================
// VIEWER
// ==================================================

function ModelViewer({
  waveRequest,
  speechRef,
}: {
  waveRequest: number;
  speechRef: React.RefObject<SpeechTiming>;
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
      style={{ width: "100%", height: "100%" }}
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
          speechRef={speechRef}
        />

        <Environment preset="studio" />
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

// ==================================================
// APPLICATION + BROWSER SPEECH
// ==================================================

export default function App() {
  const [waveRequest, setWaveRequest] = useState(0);

  const [message, setMessage] = useState(
    "Hello there! My name is Mr. Seconds. " +
    "It's wonderful to meet you! " +
    "What shall we talk about today?"
  );

  const [isSpeaking, setIsSpeaking] = useState(false);

  const [speechError, setSpeechError] = useState("");

  const [showInfo, setShowInfo] = useState(true);

  const speechRef = useRef<SpeechTiming>(
    newSpeechTiming()
  );

  const utteranceRef =
    useRef<SpeechSynthesisUtterance | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window;

  // Stop audio when this component is removed.
  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      speechRef.current.active = false;
      utteranceRef.current = null;
    };
  }, []);

  function stopSpeaking() {
    // Invalidate callbacks from the old utterance.
    utteranceRef.current = null;
    speechRef.current.active = false;

    if (supported) {
      window.speechSynthesis.cancel();
    }

    setIsSpeaking(false);
  }

  function speak() {
    if (!supported) {
      setSpeechError(
        "This browser does not support speech synthesis."
      );
      return;
    }

    const text = message.trim();

    if (!text) {
      setSpeechError("Please type something first.");
      return;
    }

    stopSpeaking();
    setSpeechError("");

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = "en-US";
    utterance.rate = 0.92;
    utterance.pitch = 1.07;
    utterance.volume = 1;

    // Prefer an available English voice.
    const voices = window.speechSynthesis.getVoices();

    const preferred =
      voices.find(
        (voice) =>
          voice.lang.toLowerCase() === "en-us" &&
          voice.localService
      ) ??
      voices.find(
        (voice) =>
          voice.lang.toLowerCase().startsWith("en")
      );

    if (preferred) {
      utterance.voice = preferred;
    }

    utteranceRef.current = utterance;

    const timing = speechRef.current;
    timing.text = text;
    timing.active = false;
    timing.hasBoundary = false;
    timing.word = "";
    timing.startedAt = 0;
    timing.wordStartedAt = 0;

    utterance.onstart = () => {
      if (utteranceRef.current !== utterance) {
        return;
      }

      const now = performance.now();

      timing.active = true;
      timing.startedAt = now;
      timing.wordStartedAt = now;
      timing.hasBoundary = false;

      setIsSpeaking(true);
    };

    utterance.onboundary = (event) => {
      if (utteranceRef.current !== utterance) {
        return;
      }

      const remainder = text.slice(event.charIndex);

      const word = remainder.match(/^[A-Za-z']+/)?.[0];

      if (word) {
        timing.word = word;
        timing.wordStartedAt = performance.now();
        timing.hasBoundary = true;
      }
    };

    utterance.onend = () => {
      if (utteranceRef.current !== utterance) {
        return;
      }

      timing.active = false;
      utteranceRef.current = null;
      setIsSpeaking(false);
    };

    utterance.onerror = (event) => {
      if (utteranceRef.current !== utterance) {
        return;
      }

      timing.active = false;
      utteranceRef.current = null;
      setIsSpeaking(false);

      if (event.error !== "canceled") {
        setSpeechError(
          `Speech error: ${event.error}`
        );
      }
    };

    window.speechSynthesis.speak(utterance);
  }

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
          Voice Preview • V2.3
        </span>
      </header>

      <section className="viewer">
        <ModelViewer
          waveRequest={waveRequest}
          speechRef={speechRef}
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
              What should Mr. Seconds say?
            </label>

            <textarea
              id="speech-message"
              value={message}
              rows={4}
              maxLength={1000}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
              placeholder="Type a message..."
              className="speech-input"
            />

            <button
              className="wave-button talk-button"
              disabled={!supported}
              onClick={
                isSpeaking ? stopSpeaking : speak
              }
            >
              {isSpeaking
                ? "⏹ Stop Speaking"
                : "🔊 Speak"}
            </button>

            {speechError && (
              <p className="speech-error" role="alert">
                {speechError}
              </p>
            )}
          </div>

          <div className="control-description">
            {isSpeaking
              ? "Mr. Seconds is speaking..."
              : "Idle and blinking active"}
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
        <span>● Interactive 3D companion</span>
        <span>Mr. Seconds • V2.3</span>
      </footer>
    </main>
  );
}

useGLTF.preload(MODEL_PATH);
