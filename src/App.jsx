import { OrbitControls, KeyboardControls } from '@react-three/drei'
import { Canvas, extend, useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useControls } from 'leva'

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

// import InteractiveSphere from './components/InteractiveSphere';
import Galaxy from './components/Galaxy';
import Core from './components/ThomasAttractor'
import WaterDrop from './components/WaterDrop';
import Spiral from './components/Spiral';
import Planet from "./components/Planet"
import AirshipController from './components/AirshipController'

extend(THREE)

// Keyboard input mapping
const keyboardMap = [
  { name: 'forward', keys: ['KeyW', 'ArrowUp'] },
  { name: 'backward', keys: ['KeyS', 'ArrowDown'] },
  { name: 'left', keys: ['KeyA', 'ArrowLeft'] },
  { name: 'right', keys: ['KeyD', 'ArrowRight'] },
  { name: 'sprint', keys: ['ShiftLeft', 'ShiftRight'] },
]

// Scene component to use hooks inside Canvas
function Scene() {
  const { debug } = useControls({ debug: false })
  const playerPositionRef = useRef(new THREE.Vector3())

  // Callback to update player position for terrain following
  const handlePositionUpdate = (pos) => {
    playerPositionRef.current.copy(pos)
  }

  return (
    <>
      <color attach="background" args={['rgba(0, 0, 0, 1)']} />

      {/* Show OrbitControls in debug mode */}
      {debug && <OrbitControls />}

      {/* Physics world with zero gravity (airship floats) */}
      <Physics gravity={[0, 0, 0]}>
        <AirshipController debug={debug} onPositionUpdate={handlePositionUpdate} />
      </Physics>

      {/* Terrain follows player */}
      <Planet followPosition={playerPositionRef.current} />
    </>
  )
}

const App = () => {
  return (
    <KeyboardControls map={keyboardMap}>
      <Canvas
        style={{ width: '100vw', height: '100vh', display: 'block' }}
        shadows
        camera={{ position: [3, 3, 3] }}
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer(props);
          await renderer.init();
          // console.log('Renderer backend', renderer.backend);
          return renderer;
        }}
      >
        <Suspense>
          <Core />
          <Scene />
        </Suspense>
      </Canvas>
    </KeyboardControls>
  );
}


// const App = () => {
//   return (
//     <>
//       <Canvas
//         shadows
//         camera={{ position: [3, 3, 3] }}
//         gl={async (props) => {
//           const renderer = new THREE.WebGPURenderer(props);
//           await renderer.init();
//           return renderer;
//         }}
//       >
//         <Suspense>
//           <color attach="background" args={['#000000']} />
//           <OrbitControls />
//           <Galaxy />
//         </Suspense>
//       </Canvas>
//     </>
//   );
// };

export default App