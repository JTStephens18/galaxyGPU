import { useFrame, extend, useThree } from "@react-three/fiber";
import React, { useMemo, useEffect } from "react";
import * as THREE from 'three/webgpu';
import { SpriteNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';

// 1. Ensure all TSL functions are imported
import {
    Fn, float, int, vec2, vec3, sin, cos,
    instancedArray, instanceIndex, uniform,
    texture, uv, smoothstep, mix, length, billboarding
} from 'three/tsl';

import { v4 as uuidv4 } from 'uuid';

// extend(THREE);

const STAR_COUNT = 1_000_000;

const positionBuffer = instancedArray(STAR_COUNT, 'vec3');
const velocityBuffer = instancedArray(STAR_COUNT, 'vec3');
const originalPositionBuffer = instancedArray(STAR_COUNT, 'vec3');
const densityFactorBuffer = instancedArray(STAR_COUNT, 'float');

export const hash = Fn(([seed]) => {
    const h = seed.fract().mul(0.1031);
    return h.mul(h.add(33.33)).mul(h.add(h)).fract();
});

export const rotateXZ = Fn(([p, angle]) => {
    const cosA = cos(angle);
    const sinA = sin(angle);
    return vec3(
        p.x.mul(cosA).sub(p.z.mul(sinA)),
        p.y,
        p.x.mul(sinA).add(p.z.mul(cosA))
    );
});

const computeInit = Fn(() => {

    const idx = instanceIndex;
    const seed = idx.toFloat();

    const armCount = int(4);
    const galaxyRadius = float(50.0);
    const spiralTightness = float(2.0);
    const armWidth = float(8.0);
    const thickness = float(5.0);
    const randomness = float(5.0);

    // Generate radius - square root for even distribution
    const radius = hash(seed.add(1)).pow(0.5).mul(galaxyRadius);
    const normalizedRadius = radius.div(galaxyRadius);

    // Select which spiral arm this particle belongs to
    const armIndex = hash(seed.add(2)).mul(armCount).floor();
    const armAngle = armIndex.mul(6.28318).div(armCount); // 2π / armCount

    // Calculate spiral angle (increases with distance)
    const spiralAngle = normalizedRadius.mul(spiralTightness).mul(6.28318);
    const totalAngle = armAngle.add(spiralAngle);

    // Add randomness perpendicular and parallel to the arm
    const radiusOffset = hash(seed.add(3)).sub(0.5).mul(2.0).mul(armWidth);
    const angleOffset = hash(seed.add(4)).sub(0.5).mul(2.0).mul(randomness).div(radius.add(1.0));
    const finalAngle = totalAngle.add(angleOffset);
    const finalRadius = radius.add(radiusOffset);

    // Calculate the X and Z from polar coordinates
    const x = cos(finalAngle).mul(finalRadius);
    const z = sin(finalAngle).mul(finalRadius);

    // Vertical position - thicker in the center, thinner at edges
    const maxThickness = thickness.mul(float(1.0).sub(normalizedRadius.mul(0.7)));
    const y = hash(seed.add(5)).sub(0.5).mul(2.0).mul(maxThickness)

    // Store position in buffers
    const position = vec3(x, y, z);
    positionBuffer.element(idx).assign(position);
    originalPositionBuffer.element(idx).assign(position);

    // Calculate initial orbital velocity (perpendicular to radius)
    const offsetRadius = finalRadius.add(0.5);
    const orbitalSpeed = float(1.0).div(offsetRadius).mul(5.0);
    const velocityAngle = finalAngle.add(1.5708); // +90 degrees
    const velocity = vec3(
        cos(velocityAngle).mul(orbitalSpeed),
        0,
        sin(velocityAngle).mul(orbitalSpeed)
    );
    velocityBuffer.element(idx).assign(velocity);

    // Calculate density factor for coloring
    const radialSparsity = radiusOffset.abs().div(armWidth.mul(0.5).add(0.01));
    const angularSparsity = angleOffset.abs().div(randomness.mul(0.5).add(0.01));
    const sparsityFactor = radialSparsity.add(angularSparsity).mul(0.5).min(1.0);

    densityFactorBuffer.element(idx).assign(sparsityFactor);

})().compute(STAR_COUNT);

const computeUpdate = Fn(() => {

    const idx = instanceIndex;

    // Read current position from buffers

    const position = positionBuffer.element(idx).toVar();
    const velocity = velocityBuffer.element(idx).toVar();

    const deltaTime = uniform(0.016); // ~60 FPS

    // Inner particle rotate faster than outer particles
    const distFromCenter = length(vec2(position.x, position.z));
    const rotationFactor = float(1.0).div(distFromCenter.mul(0.1).add(1.0));
    const rotationAmount = rotationFactor.mul(deltaTime).mul(0.5);

    // Rotate position and velocity around Y axis
    position.assign(rotateXZ(position, rotationAmount));
    velocity.assign(rotateXZ(velocity, rotationAmount));

    // Write updated state back to buffers
    positionBuffer.element(idx).assign(position);
    velocityBuffer.element(idx).assign(velocity);

})().compute(STAR_COUNT);

extend({ SpriteNodeMaterial, MeshBasicNodeMaterial })

const Galaxy = () => {

    const { gl } = useThree();

    // 2. Run initialization ONCE on mount
    useEffect(() => {
        // computeAsync is safer for WebGPU init steps
        gl.computeAsync(computeInit);
    }, [gl]);

    // 3. Run update EVERY FRAME
    useFrame(() => {
        gl.compute(computeUpdate);
    });

    // 2. Create the shader graph ONCE using useMemo
    const { posNode, positionLogic, colorNode, opacityNode, scaleNode } = useMemo(() => {

        const uScale = uniform(0.8);

        // A. Convert buffers to TSL attributes
        const starPos = positionBuffer.toAttribute();
        const densityFactor = densityFactorBuffer.toAttribute();

        // const positionLogic = starPos.add(billboarding().mul(uScale));

        // B. Procedural Circle (Fix: uv() is a function)
        const dist = uv().sub(0.5).length().mul(2.0);

        // C. Smooth Falloff (Fix: lowercase smoothstep)
        const circleShape = smoothstep(1.0, 0.6, dist);

        // D. Color mixing
        const denseColor = vec3(0.4, 0.6, 1.0);
        const sparseColor = vec3(1.0, 0.6, 0.3);
        const starColor = mix(denseColor, sparseColor, densityFactor);

        return {
            // positionLogic,
            posNode: starPos,
            colorNode: starColor,
            opacityNode: circleShape,
            scaleNode: uniform(0.8)
        }
    }, [])

    return (
        <instancedMesh args={[undefined, undefined, STAR_COUNT]} frustumCulled={false}>
            {/* 3. Use PlaneGeometry. SpriteNodeMaterial will handle the billboarding (facing camera) */}
            {/* <planeGeometry args={[1, 1]} /> */}

            {/* 4. Pass the NODES to the props, not the material object */}
            {/* <meshBasicNodeMaterial
                transparent
                blending={THREE.AdditiveBlending}
                depthWrite={false}

                vertexNode={billboarding()}

                // TSL Inputs
                positionNode={positionLogic}
                colorNode={colorNode}
                opacityNode={opacityNode}
            // scaleNode={scaleNode}
            /> */}


            <sprite count={STAR_COUNT}>
                <spriteNodeMaterial
                    key={uuidv4()}
                    colorNode={colorNode}
                    positionNode={posNode}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </sprite>
        </instancedMesh>
    );
}

export default Galaxy;


// import { OrbitControls } from '@react-three/drei';
// import { Canvas, extend, useThree, useFrame } from '@react-three/fiber';
// import { Suspense, useEffect, useMemo, useRef, useCallback } from 'react';
// import * as THREE from 'three/webgpu';
// import {
//     vec3,
//     mix,
//     uv,
//     Fn,
//     instancedArray,
//     instanceIndex,
//     wgslFn,
//     code,
// } from 'three/tsl';
// import { v4 as uuidv4 } from 'uuid';

// // import './scene.css';

// extend(THREE);

// const COUNT = 30000;

// const Galaxy = () => {
//     const { gl } = useThree();

//     const { nodes, uniforms, utils } = useMemo(() => {
//         const spawnPositionsBuffer = instancedArray(COUNT, 'vec3');
//         const offsetPositionsBuffer = instancedArray(COUNT, 'vec3');

//         const spawnPosition = spawnPositionsBuffer.element(instanceIndex);
//         const offsetPosition = offsetPositionsBuffer.element(instanceIndex);

//         const hash = code(`
//       fn hash(index: u32) -> f32 {
//         return fract(sin(f32(index) * 12.9898) * 43758.5453);
//       }
//     `);

//         const computeInitWgsl = wgslFn(`
//       fn computeInit(
//         spawnPositions: ptr<storage, array<vec3f>, read_write>,
//         offsetPositions: ptr<storage, array<vec3f>, read_write>,
//         index: u32
//       ) -> void {
//         let h0 = hash(index);
//         let h1 = hash(index + 1u);
//         let h2 = hash(index + 2u);
        
//         let distance = sqrt(h0 * 4.0);
//         let theta = h1 * 6.28318530718; // 2 * PI
//         let phi = h2 * 3.14159265359; // PI
        
//         let x = distance * sin(phi) * cos(theta);
//         let y = distance * sin(phi) * sin(theta);
//         let z = distance * cos(phi);
        
//         spawnPositions[index] = vec3f(x, y, z);
//         offsetPositions[index] = vec3f(0.0);
//       }
//     `,
//             [hash],
//         );

//         const computeNode = computeInitWgsl({
//             spawnPositions: spawnPositionsBuffer,
//             offsetPositions: offsetPositionsBuffer,
//             index: instanceIndex,
//         }).compute(COUNT);

//         const scaleNode = wgslFn(`
//       fn scaleNode() -> f32 {
//         return randValue(0.01, 0.04, 3u);
//       }
    
//       fn randValue(min: f32, max: f32, seed: u32) -> f32 {
//         return hash(seed) * (max - min) + min;
//       }
//     `,
//             [hash],
//         )();

//         const positionNode = Fn(() => {
//             const pos = spawnPosition.add(offsetPosition);
//             return pos;
//         })();

//         const particleColor = wgslFn(`
//       fn colorNode(
//         spawnPos: vec3f,
//         offsetPos: vec3f,
//         uvCoord: vec2f
//       ) -> vec4f {
//         let color = vec3f(0.24, 0.43, 0.96);
//         let distanceToCenter = min(
//           distance(spawnPos + offsetPos, vec3f(0.0, 0.0, 0.0)),
//           2.75
//         );
        
//         let strength = distance(uvCoord, vec2f(0.5));
        
//         let distColor = mix(
//           vec3f(0.97, 0.7, 0.45),
//           color,
//           distanceToCenter * 0.4
//         );
        
//         let fillMask = 1.0 - strength * 2.0;
//         let finalColor = mix(vec3f(0.0), distColor, fillMask);
        
//         let circle = smoothstep(0.5, 0.49, strength);
//         return vec4f(finalColor * circle, 1.0);
//       }
//     `);

//         const colorNode = particleColor({
//             spawnPos: spawnPosition,
//             offsetPos: offsetPosition,
//             uvCoord: uv(),
//         });


//         return {
//             nodes: {
//                 positionNode,
//                 computeNode,
//                 colorNode,
//                 scaleNode,
//             },
//             uniforms: {},
//             utils: {}
//         }
//     }, []);

//     const compute = useCallback(async () => {
//         try {
//             await gl.computeAsync(nodes.computeNode);
//         } catch (error) {
//             console.error(error);
//         }
//     }, [nodes.computeNode, gl]);

//     useEffect(() => {
//         compute();
//     }, [compute]);

//     return (
//         <>
//             <sprite count={COUNT}>
//                 <spriteNodeMaterial
//                     key={uuidv4()}
//                     colorNode={nodes.colorNode}
//                     positionNode={nodes.positionNode}
//                     scaleNode={nodes.scaleNode}
//                     transparent
//                     depthWrite={false}
//                     blending={THREE.AdditiveBlending}
//                 />
//             </sprite>
//         </>
//     );
// };

// export default Galaxy