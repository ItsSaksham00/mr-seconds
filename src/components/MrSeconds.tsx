
import { useMemo, useRef, useState } from "react";
import { Float } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  CatmullRomCurve3,
  MathUtils,
  Shape,
  Vector3,
} from "three";
import type { Group } from "three";

type Expression = "normal" | "happy" | "surprised";
type Point = [number, number, number];

const C = {
  teal: "#17636a",
  cream: "#fff1d2",
  gold: "#edb95b",
  ink: "#292d36",
  white: "#fffefa",
  shoes: "#303746",
  tongue: "#db7778",
};

const FACE_RADIUS = 1.17;
const EYE_HEIGHT = 0.68;
const MAX_EYE_HEIGHT = FACE_RADIUS * 0.6;

// Smooth cartoon curves
function Curve({
  points,
  color = C.ink,
  thickness = 0.025,
}: {
  points: Point[];
  color?: string;
  thickness?: number;
}) {
  const curve = useMemo(
    () =>
      new CatmullRomCurve3(
        points.map((p) => new Vector3(...p))
      ),
    [points]
  );

  return (
    <mesh>
      <tubeGeometry args={[curve, 32, thickness, 8, false]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

// Custom irregular egg shape
function createEyeShape() {
  const h = Math.min(EYE_HEIGHT, MAX_EYE_HEIGHT) / 2;
  const shape = new Shape();

  shape.moveTo(0, h);

  shape.bezierCurveTo(
    -0.12, h + 0.005,
    -0.21, 0.23,
    -0.22, 0.07
  );

  shape.bezierCurveTo(
    -0.26, -0.13,
    -0.21, -h,
    0, -h
  );

  shape.bezierCurveTo(
    0.21, -h,
    0.26, -0.13,
    0.22, 0.07
  );

  shape.bezierCurveTo(
    0.21, 0.23,
    0.12, h + 0.005,
    0, h
  );

  shape.closePath();
  return shape;
}

// Five individual lashes fanning upward
function Eyelashes({ side }: { side: -1 | 1 }) {
  const lashes: Point[][] = [
    [
      [-0.19, 0.20, 0.035],
      [-0.25, 0.29, 0.035],
      [-0.28, 0.40, 0.035],
    ],
    [
      [-0.13, 0.29, 0.035],
      [-0.17, 0.39, 0.035],
      [-0.17, 0.48, 0.035],
    ],
    [
      [-0.045, 0.335, 0.035],
      [-0.06, 0.44, 0.035],
      [-0.055, 0.51, 0.035],
    ],
    [
      [0.065, 0.33, 0.035],
      [0.09, 0.43, 0.035],
      [0.11, 0.49, 0.035],
    ],
    [
      [0.155, 0.27, 0.035],
      [0.21, 0.34, 0.035],
      [0.23, 0.41, 0.035],
    ],
  ];

  return (
    <group scale={[side, 1, 1]}>
      {lashes.map((points, index) => (
        <Curve
          key={index}
          points={points}
          color={C.ink}
          thickness={0.014}
        />
      ))}
    </group>
  );
}

function Eye({
  side,
  eyeRef,
  pupilRef,
}: {
  side: -1 | 1;
  eyeRef: React.RefObject<Group | null>;
  pupilRef: React.RefObject<Group | null>;
}) {
  const shape = useMemo(createEyeShape, []);

  return (
    <group
      ref={eyeRef}
      position={[side * 0.34, 0.22, 0.25]}
    >
      {/* Dark eye outline */}
      <mesh scale={[1.07, 1.02, 1]}>
        <shapeGeometry args={[shape, 48]} />
        <meshBasicMaterial color={C.ink} />
      </mesh>

      {/* White eye interior */}
      <mesh position={[0, 0, 0.009]}>
        <shapeGeometry args={[shape, 48]} />
        <meshBasicMaterial color={C.white} />
      </mesh>

      {/* Small pupil looking slightly upward */}
      <group
        ref={pupilRef}
        position={[0.025, 0.12, 0.025]}
      >
        <mesh scale={[0.075, 0.15, 1]}>
          <circleGeometry args={[1, 40]} />
          <meshBasicMaterial color={C.ink} />
        </mesh>

        <mesh
          position={[-0.023, 0.05, 0.008]}
          scale={[0.022, 0.038, 1]}
        >
          <circleGeometry args={[1, 20]} />
          <meshBasicMaterial color={C.white} />
        </mesh>
      </group>

      {/* Eyelashes attached to eye */}
      <Eyelashes side={side} />
    </group>
  );
}

function Mouth({
  expression,
}: {
  expression: Expression;
}) {
  if (expression === "surprised") {
    return (
      <mesh
        position={[0, -0.58, 0.26]}
        scale={[0.12, 0.17, 1]}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color={C.ink} />
      </mesh>
    );
  }

  if (expression === "happy") {
    return (
      <group position={[0, -0.58, 0.26]}>
        <mesh scale={[0.28, 0.17, 1]}>
          <circleGeometry args={[1, 40]} />
          <meshBasicMaterial color={C.ink} />
        </mesh>
        <mesh
          position={[0, -0.08, 0.01]}
          scale={[0.16, 0.06, 1]}
        >
          <circleGeometry args={[1, 24]} />
          <meshBasicMaterial color={C.tongue} />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      {/* Upper smile */}
      <Curve
        points={[
          [-0.31, -0.53, 0.26],
          [-0.15, -0.59, 0.26],
          [0, -0.60, 0.26],
          [0.15, -0.59, 0.26],
          [0.31, -0.53, 0.26],
        ]}
        thickness={0.022}
      />

      {/* Lower smile line */}
      <Curve
        points={[
          [-0.29, -0.57, 0.26],
          [-0.14, -0.69, 0.26],
          [0, -0.72, 0.26],
          [0.14, -0.69, 0.26],
          [0.29, -0.57, 0.26],
        ]}
        thickness={0.022}
      />
    </group>
  );
}

function Glove({ side }: { side: -1 | 1 }) {
  return (
    <group scale={[side, 1, 1]}>
      <mesh scale={[0.19, 0.20, 0.11]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color={C.white} />
      </mesh>

      {[-0.12, -0.04, 0.04, 0.12].map((x) => (
        <mesh key={x} position={[x, -0.17, 0]}>
          <capsuleGeometry args={[0.047, 0.12, 8, 12]} />
          <meshStandardMaterial color={C.white} />
        </mesh>
      ))}

      <mesh
        position={[0.21, -0.02, 0]}
        rotation={[0, 0, -0.65]}
      >
        <capsuleGeometry args={[0.06, 0.1, 8, 12]} />
        <meshStandardMaterial color={C.white} />
      </mesh>
    </group>
  );
}

function Arm({ side }: { side: -1 | 1 }) {
  return (
    <group>
      <Curve
        points={[
          [0, 0, 0],
          [side * 0.18, -0.09, 0],
          [side * 0.38, -0.34, 0],
          [side * 0.53, -0.39, 0],
        ]}
        color={C.teal}
        thickness={0.055}
      />

      <group position={[side * 0.57, -0.42, 0.06]}>
        <Glove side={side} />
      </group>
    </group>
  );
}

function HourMarkers() {
  return (
    <group>
      {Array.from({ length: 12 }, (_, i) => {
        const major = i % 3 === 0;
        const angle = (i * Math.PI) / 6;

        const length = major ? 0.19 : 0.115;
        const width = major ? 0.065 : 0.026;
        const radius = 1.085 - length / 2;

        return (
          <mesh
            key={i}
            position={[
              Math.sin(angle) * radius,
              Math.cos(angle) * radius,
              0.195,
            ]}
            rotation={[0, 0, -angle]}
          >
            <boxGeometry args={[width, length, 0.012]} />
            <meshBasicMaterial color={C.gold} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function MrSeconds() {
  const body = useRef<Group>(null);
  const leftEye = useRef<Group>(null);
  const rightEye = useRef<Group>(null);
  const leftPupil = useRef<Group>(null);
  const rightPupil = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);

  const [expression, setExpression] =
    useState<Expression>("normal");

  useFrame(({ clock, pointer }, delta) => {
    const t = clock.getElapsedTime();

    if (body.current) {
      body.current.rotation.z =
        Math.sin(t * 1.3) * 0.025;
    }

    // Blinking
    const phase = t % 4.5;
    let blink = 1;

    if (phase > 4.15 && phase < 4.35) {
      const progress = (phase - 4.15) / 0.2;
      blink =
        0.06 +
        0.94 * Math.abs(Math.cos(progress * Math.PI));
    }

    [leftEye, rightEye].forEach((eye) => {
      if (eye.current) {
        eye.current.scale.y = MathUtils.damp(
          eye.current.scale.y,
          blink,
          35,
          delta
        );
      }
    });

    // Moving pupils
    [leftPupil, rightPupil].forEach((pupil) => {
      if (pupil.current) {
        const targetX = MathUtils.clamp(
          pointer.x * 0.045,
          -0.045,
          0.045
        );

        const targetY = MathUtils.clamp(
          pointer.y * 0.045,
          -0.045,
          0.045
        );

        pupil.current.position.x = MathUtils.damp(
          pupil.current.position.x,
          0.025 + targetX,
          6,
          delta
        );

        pupil.current.position.y = MathUtils.damp(
          pupil.current.position.y,
          0.12 + targetY,
          6,
          delta
        );
      }
    });

    // Arm movement
    if (leftArm.current) {
      leftArm.current.rotation.z =
        Math.sin(t * 1.1) * 0.06;
    }

    if (rightArm.current) {
      const waving = Math.sin(t * 0.7) > 0.85;
      const target = waving
        ? -0.5 + Math.sin(t * 10) * 0.15
        : -0.04;

      rightArm.current.rotation.z = MathUtils.damp(
        rightArm.current.rotation.z,
        target,
        5,
        delta
      );
    }
  });

  function nextExpression() {
    setExpression((current) => {
      if (current === "normal") return "happy";
      if (current === "happy") return "surprised";
      return "normal";
    });
  }

  return (
    <Float
      speed={1.4}
      floatIntensity={0.18}
      rotationIntensity={0}
    >
      <group
        ref={body}
        onClick={(event) => {
          event.stopPropagation();
          nextExpression();
        }}
      >
        {/* Clock body */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.27, 1.27, 0.23, 80]} />
          <meshStandardMaterial
            color={C.teal}
            roughness={0.45}
          />
        </mesh>

        {/* Face */}
        <mesh position={[0, 0, 0.13]}>
          <circleGeometry args={[FACE_RADIUS, 80]} />
          <meshStandardMaterial
            color={C.cream}
            roughness={0.95}
          />
        </mesh>

        {/* Gold rim */}
        <mesh position={[0, 0, 0.17]}>
          <torusGeometry args={[1.18, 0.052, 12, 90]} />
          <meshStandardMaterial
            color={C.gold}
            metalness={0.5}
            roughness={0.32}
          />
        </mesh>

        <HourMarkers />

        {/* Eyes with curved eyelashes */}
        <Eye
          side={-1}
          eyeRef={leftEye}
          pupilRef={leftPupil}
        />
        <Eye
          side={1}
          eyeRef={rightEye}
          pupilRef={rightPupil}
        />

        {/* Small nose from your sketch */}
        <mesh position={[0, -0.32, 0.265]}>
          <circleGeometry args={[0.038, 24]} />
          <meshBasicMaterial color={C.ink} />
        </mesh>

        <Mouth expression={expression} />

        {/* Arms */}
        <group
          ref={leftArm}
          position={[-1.15, -0.26, 0]}
        >
          <Arm side={-1} />
        </group>

        <group
          ref={rightArm}
          position={[1.15, -0.26, 0]}
        >
          <Arm side={1} />
        </group>

        {/* Legs and shoes */}
        {([-1, 1] as const).map((side) => (
          <group key={side}>
            <mesh position={[side * 0.39, -1.42, 0]}>
              <capsuleGeometry args={[0.055, 0.33, 8, 16]} />
              <meshStandardMaterial color={C.teal} />
            </mesh>

            <mesh
              position={[side * 0.39, -1.72, 0.16]}
              scale={[0.24, 0.13, 0.34]}
            >
              <sphereGeometry args={[1, 32, 24]} />
              <meshStandardMaterial
                color={C.shoes}
                roughness={0.65}
              />
            </mesh>
          </group>
        ))}
      </group>
    </Float>
  );
}
