import { OrbitControls } from '@react-three/drei'
import { Canvas, extend, useThree, type ThreeToJSXElements } from '@react-three/fiber'
import { Suspense, useEffect, useMemo } from 'react'

import * as THREE from 'three/webgpu'

import {
  Fn,
  vec3,
  abs,
  length,
  clamp,
  uv,
  mix,
} from 'three/tsl';
import type { WebGPURendererParameters } from 'three/src/renderers/webgpu/WebGPURenderer.Nodes.js';

import InteractiveSphere from './components/InteractiveSphere';

const App = () => {
  return (
    <>
      <Canvas
        style={{ width: '100vw', height: '100vh', display: 'block' }}
        shadows
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer(
            props as WebGPURendererParameters
          );
          await renderer.init();
          console.log('Renderer backend', renderer.backend);
          return renderer;
        }}
      >

        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} castShadow />

        <Suspense>
          <OrbitControls />
          {/* <Core /> */}
          <InteractiveSphere />
        </Suspense>
      </Canvas>
    </>
  );
}

export default App
