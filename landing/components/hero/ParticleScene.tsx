'use client';

import { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

function Particles({ count = 800 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      const position = new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20
      );
      const speed = 0.2 + Math.random() * 0.5;
      const offset = Math.random() * Math.PI * 2;
      const radius = 0.02 + Math.random() * 0.04;
      // Colour: purple → blue → pink
      const colorChoice = Math.random();
      let color: THREE.Color;
      if (colorChoice < 0.33) {
        color = new THREE.Color('#7c3aed'); // purple
      } else if (colorChoice < 0.66) {
        color = new THREE.Color('#3b82f6'); // blue
      } else {
        color = new THREE.Color('#f472b6'); // pink
      }
      temp.push({ position, speed, offset, radius, color });
    }
    return temp;
  }, [count]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorArray = useMemo(() => {
    const colors = new Float32Array(count * 3);
    particles.forEach((particle, i) => {
      particle.color.toArray(colors, i * 3);
    });
    return colors;
  }, [particles, count]);

  useFrame((state) => {
    if (!meshRef.current) return;

    const time = state.clock.getElapsedTime();

    // Track mouse in normalised coordinates
    const pointer = state.pointer;
    mouseRef.current.x = pointer.x * viewport.width * 0.5;
    mouseRef.current.y = pointer.y * viewport.height * 0.5;

    particles.forEach((particle, i) => {
      const { position, speed, offset } = particle;

      // Gentle orbit motion
      const x =
        position.x +
        Math.sin(time * speed * 0.3 + offset) * 1.5;
      const y =
        position.y +
        Math.cos(time * speed * 0.2 + offset * 1.3) * 1.2;
      const z =
        position.z +
        Math.sin(time * speed * 0.15 + offset * 0.7) * 1.0;

      // Mouse repulsion
      const dx = x - mouseRef.current.x;
      const dy = y - mouseRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = 3;
      const repulsion = dist < maxDist ? (1 - dist / maxDist) * 0.8 : 0;
      const repelX = dist > 0.01 ? (dx / dist) * repulsion : 0;
      const repelY = dist > 0.01 ? (dy / dist) * repulsion : 0;

      dummy.position.set(x + repelX, y + repelY, z);
      dummy.scale.setScalar(particle.radius * (10 + Math.sin(time + offset) * 3));
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial toneMapped={false}>
        <instancedBufferAttribute
          attach="geometry-attributes-color"
          args={[colorArray, 3]}
        />
      </meshBasicMaterial>
    </instancedMesh>
  );
}

function ParticlesWithColour({ count = 800 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      const position = new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20
      );
      const speed = 0.2 + Math.random() * 0.5;
      const offset = Math.random() * Math.PI * 2;
      const radius = 0.02 + Math.random() * 0.04;
      const colorChoice = Math.random();
      let color: THREE.Color;
      if (colorChoice < 0.33) {
        color = new THREE.Color('#7c3aed');
      } else if (colorChoice < 0.66) {
        color = new THREE.Color('#3b82f6');
      } else {
        color = new THREE.Color('#f472b6');
      }
      temp.push({ position, speed, offset, radius, color });
    }
    return temp;
  }, [count]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.getElapsedTime();
    const pointer = state.pointer;
    mouseRef.current.x = pointer.x * viewport.width * 0.5;
    mouseRef.current.y = pointer.y * viewport.height * 0.5;

    const tempColor = new THREE.Color();

    particles.forEach((particle, i) => {
      const { position, speed, offset } = particle;

      const x = position.x + Math.sin(time * speed * 0.3 + offset) * 1.5;
      const y = position.y + Math.cos(time * speed * 0.2 + offset * 1.3) * 1.2;
      const z = position.z + Math.sin(time * speed * 0.15 + offset * 0.7) * 1.0;

      const dx = x - mouseRef.current.x;
      const dy = y - mouseRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = 3;
      const repulsion = dist < maxDist ? (1 - dist / maxDist) * 0.8 : 0;
      const repelX = dist > 0.01 ? (dx / dist) * repulsion : 0;
      const repelY = dist > 0.01 ? (dy / dist) * repulsion : 0;

      dummy.position.set(x + repelX, y + repelY, z);
      dummy.scale.setScalar(particle.radius * (10 + Math.sin(time + offset) * 3));
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);

      // Set per-instance colour
      tempColor.copy(particle.color);
      meshRef.current!.setColorAt(i, tempColor);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

function AmbientGlow() {
  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[5, 5, 5]} intensity={0.5} color="#7c3aed" />
      <pointLight position={[-5, -5, 3]} intensity={0.3} color="#3b82f6" />
      <pointLight position={[0, 3, -5]} intensity={0.2} color="#f472b6" />
      {/* Subtle fog for depth */}
      <fog attach="fog" args={['#030014', 8, 25]} />
    </>
  );
}

export default function ParticleScene() {
  return (
    <div className="absolute inset-0 z-0 h-screen">
      <Suspense
        fallback={
          <div className="h-screen w-full bg-[#030014]" />
        }
      >
        <Canvas
          camera={{ position: [0, 0, 10], fov: 60 }}
          dpr={[1, 1.5]}
          gl={{ antialias: false, alpha: false }}
          style={{ background: '#030014' }}
        >
          <AmbientGlow />
          <ParticlesWithColour count={800} />
        </Canvas>
      </Suspense>
    </div>
  );
}
