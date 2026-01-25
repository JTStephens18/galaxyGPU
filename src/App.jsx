import { OrbitControls } from '@react-three/drei'
import { Canvas, extend, useThree } from '@react-three/fiber'
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

// import InteractiveSphere from './components/InteractiveSphere';
import Galaxy from './components/Galaxy';
import Core from './components/ThomasAttractor'
import WaterDrop from './components/WaterDrop';

extend(THREE)

const App = () => {
  return (
    <>
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
        {/* <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} castShadow /> */}

        <Suspense>

          <color attach="background" args={['rgba(43, 32, 32, 1)']} />
          <OrbitControls />
          {/* <Core /> */}
          {/* <Galaxy /> */}
          <WaterDrop />
        </Suspense>
      </Canvas>
    </>
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