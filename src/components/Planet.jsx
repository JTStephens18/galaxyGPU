import { useFrame, extend, useThree, useLoader } from "@react-three/fiber";
import React, { useMemo, useEffect, useCallback, useRef } from "react";
import { useControls } from "leva";
import * as THREE from 'three/webgpu';
import { TextureLoader } from "three";

import {
    uniform, float, vec3, vec2,
    storage, instanceIndex, vertexIndex, instancedArray, Fn,
    cameraPosition, floor, smoothstep, color, texture, mix, Loop, positionWorld,
} from "three/tsl"

import { cnoise } from "./Perlin"

extend(THREE);

const fbm = Fn(([pos, octaves, frequency, amplitude, lacunarity, persistence]) => {
    const p = vec3(pos).toVar();
    const total = float(0.0).toVar();
    const currFreq = float(frequency).toVar();
    const currAmp = float(amplitude).toVar();

    Loop({ start: 0, end: octaves }, () => {
        const noiseVal = cnoise(vec3(p.x.mul(currFreq), 0.0, p.z.mul(currFreq)));

        total.addAssign(noiseVal.mul(currAmp));

        currFreq.mulAssign(lacunarity);
        currAmp.mulAssign(persistence);
    });
    return total;
});

const Planet = ({ followPosition = null }) => {

    const { scene, gl, camera } = useThree();

    const {
        octaves,
        frequency,
        amplitude,
        lacunarity,
        persistence,
        heightScale,
        heightOffset
    } = useControls('Planet Terrain', {
        octaves: { value: 2, min: 1, max: 12, step: 1 },
        frequency: { value: 0.06, min: 0.001, max: 0.5, step: 0.001 },
        amplitude: { value: 0.3, min: 0.1, max: 5.0, step: 0.1 },
        lacunarity: { value: 1.6, min: 1.0, max: 4.0, step: 0.1 },
        persistence: { value: 0.90, min: 0.1, max: 1.0, step: 0.05 },
        heightScale: { value: 20, min: 1, max: 100, step: 1 },
        heightOffset: { value: 0.15, min: -1.0, max: 1.0, step: 0.05 },
    });

    const {
        sandStart,
        sandEnd,
        grassStart,
        grassEnd,
        rockStart,
        rockEnd
    } = useControls('Planet Material', {
        sandStart: { value: -1.0, min: -10, max: 10, step: 0.1 },
        sandEnd: { value: 1.5, min: -5, max: 15, step: 0.1 },
        grassStart: { value: 1.5, min: -5, max: 15, step: 0.1 },
        grassEnd: { value: 3.0, min: 0, max: 20, step: 0.1 },
        rockStart: { value: 6.0, min: 0, max: 30, step: 0.1 },
        rockEnd: { value: 8.0, min: 5, max: 50, step: 0.1 },
    });

    const [waterTex, sandTex, grassTex, rockTex] = useLoader(TextureLoader, [
        "/water2.png",
        "/sand.jpg",
        "/grass1.png",
        "/rock.jpg"
    ]);

    [waterTex, sandTex, grassTex, rockTex].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;

        t.minFilter = THREE.NearestFilter;
        t.magFilter = THREE.NearestFilter;
    });

    const planeWidth = 100;
    const planeHeight = 100;
    const planeWidthSegments = 100;
    const planeHeightSegments = 100;

    // Calculate grid cell for snapping
    const segmentSize = planeWidth / planeWidthSegments;

    const planetMeshRef = useRef();

    const count = (planeWidthSegments + 1) * (planeHeightSegments + 1)

    // 1. CREATE TWO BUFFERS
    // 'baseStorageAttribute' is our permanent reference (Local Space)
    // 'positionStorageAttribute' is what we update and render (World Space)
    const { positionStorageAttribute, baseStorageAttribute } = useMemo(() => {
        const tempGeom = new THREE.PlaneGeometry(planeWidth, planeHeight, planeWidthSegments, planeHeightSegments);
        tempGeom.rotateX(-Math.PI / 2); // Rotate to lie on XZ plane

        const initialData = tempGeom.attributes.position.array;

        const posBuffer = new THREE.StorageBufferAttribute(initialData, 3);
        const baseBuffer = new THREE.StorageBufferAttribute(new Float32Array(initialData), 3);

        return {
            positionStorageAttribute: posBuffer,
            baseStorageAttribute: baseBuffer
        };
    }, []);

    const { nodes, uniforms } = useMemo(() => {

        const positionBuffer = storage(positionStorageAttribute, 'vec3', count);
        const baseBuffer = storage(baseStorageAttribute, 'vec3', count);

        const time = uniform(0);
        const uSegmentSize = uniform(segmentSize);
        const uCameraPosition = uniform(new THREE.Vector3());
        const uFrequency = uniform(frequency);
        const uAmplitude = uniform(amplitude);
        const uLacunarity = uniform(lacunarity);
        const uPersistence = uniform(persistence);
        const uHeightScale = uniform(heightScale);
        const uHeightOffset = uniform(heightOffset);

        const uSandStart = uniform(sandStart);
        const uSandEnd = uniform(sandEnd);
        const uGrassStart = uniform(grassStart);
        const uGrassEnd = uniform(grassEnd);
        const uRockStart = uniform(rockStart);
        const uRockEnd = uniform(rockEnd);

        const computeInit = Fn(() => {
            // Wrap storage buffer in TSL storage node    
            // const positionBuffer = storage(positionStorageAttribute, 'vec3', count);
        })().compute(count);

        const computeUpdate = Fn(() => {
            const index = instanceIndex;

            // 2. GET BASE POSITION
            // Read from the read-only buffer so we don't lose the grid shape
            const localPos = baseBuffer.element(index);

            // 3. CALCULATE "SNAPPED" CAMERA OFFSET
            // We take camera position, divide by cell size, floor it, then multiply back.
            // This ensures the grid jumps in exact "grid-unit" steps, preventing texture jitter.
            const snapX = uCameraPosition.x.div(uSegmentSize).floor().mul(uSegmentSize);
            const snapZ = uCameraPosition.z.div(uSegmentSize).floor().mul(uSegmentSize);

            // Create the World Offset Vector (moving on X and Z for the ground)
            const worldOffset = vec3(snapX, 0.0, snapZ);

            // 4. APPLY OFFSET TO GET WORLD POSITION
            // The grid physically moves to follow the camera
            const worldPos = localPos.add(worldOffset);

            // 5. SAMPLE NOISE AT WORLD POSITION
            // The noise pattern stays fixed in the world, even though the mesh is moving
            const noiseValue = fbm(worldPos, octaves, uFrequency, uAmplitude, uLacunarity, uPersistence)
            // Add offset to shift terrain upward (less water, more land)
            const height = noiseValue.add(uHeightOffset).mul(uHeightScale);

            // 6. WRITE BACK TO POSITION BUFFER
            // We update the Y height, but we also update X and Z so the mesh follows the camera
            const finalPos = vec3(worldPos.x, height, worldPos.z);

            positionBuffer.element(index).assign(finalPos);
        })().compute(count);

        const positionNode = Fn(() => {
            return positionBuffer.element(vertexIndex);
        })();


        // ======== Material Node =========

        const colorNode = Fn(() => {
            const pos = positionWorld;

            const h = pos.y;

            const worldUV = pos.xz.mul(0.25);
            const waterWorldUV = pos.xz.mul(1.0);

            const tWater = texture(waterTex, waterWorldUV);
            const tSand = texture(sandTex, worldUV);
            const tGrass = texture(grassTex, worldUV);
            const tRock = texture(rockTex, worldUV);

            let finalColor = tWater;

            const sandMix = smoothstep(uSandStart, uSandEnd, h);
            finalColor = mix(finalColor, tSand, sandMix);

            // 2. Sand to Grass transition
            // If height is between 1.5 and 3.0, blend to grass
            const grassMix = smoothstep(uGrassStart, uGrassEnd, h);
            finalColor = mix(finalColor, tGrass, grassMix);

            // 3. Grass to Rock transition
            // If height is between 6.0 and 8.0, blend to rock
            const rockMix = smoothstep(uRockStart, uRockEnd, h);
            finalColor = mix(finalColor, tRock, rockMix);

            return finalColor;
        })();

        // ======== Material Node End =========
        return {
            nodes: {
                positionNode,
                colorNode,
                computeInit,
                computeUpdate,
            },
            uniforms: {
                time,
                uSegmentSize,
                uCameraPosition,
                uFrequency,
                uAmplitude,
                uLacunarity,
                uPersistence,
                uHeightScale,
                uHeightOffset,
                uSandStart,
                uSandEnd,
                uGrassStart,
                uGrassEnd,
                uRockStart,
                uRockEnd,
            }
        }

    }, [octaves]);

    const compute = useCallback(async () => {
        try {
            // await gl.computeAsync(nodes.computeInit);
            await gl.computeAsync(nodes.computeInit);
        } catch (error) {
            console.error(error);
        }
    });

    useEffect(() => {
        compute();
    }, [compute]);

    useFrame((state) => {
        const { clock, gl, camera } = state;

        uniforms.time.value = clock.getElapsedTime();
        // Use followPosition if provided, otherwise fall back to camera
        const targetPos = followPosition || camera.position;
        uniforms.uCameraPosition.value.copy(targetPos);

        // Update Leva params
        uniforms.uFrequency.value = frequency;
        uniforms.uAmplitude.value = amplitude;
        uniforms.uLacunarity.value = lacunarity;
        uniforms.uPersistence.value = persistence;
        uniforms.uHeightScale.value = heightScale;
        uniforms.uHeightOffset.value = heightOffset;

        uniforms.uSandStart.value = sandStart;
        uniforms.uSandEnd.value = sandEnd;
        uniforms.uGrassStart.value = grassStart;
        uniforms.uGrassEnd.value = grassEnd;
        uniforms.uRockStart.value = rockStart;
        uniforms.uRockEnd.value = rockEnd;

        gl.compute(nodes.computeUpdate);
    })


    return (
        <mesh ref={planetMeshRef} frustumCulled={false}>
            <planeGeometry args={[planeWidth, planeHeight, planeWidthSegments, planeHeightSegments]} />
            <meshBasicNodeMaterial
                positionNode={nodes.positionNode}
                colorNode={nodes.colorNode}
                side={THREE.DoubleSide}
            // color="cyan"
            // wireframe={true}
            />
        </mesh>
    )
}

export default Planet;