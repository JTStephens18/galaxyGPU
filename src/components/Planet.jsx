import { useFrame, extend, useThree } from "@react-three/fiber";
import React, { useMemo, useEffect, useCallback, useRef } from "react";
import * as THREE from 'three/webgpu';

import {
    uniform, float, vec3, vec2,
    storage, instanceIndex, vertexIndex, instancedArray, Fn,
    cameraPosition, floor,
} from "three/tsl"

import { cnoise } from "./Perlin"

extend(THREE);

const Planet = ({ followPosition = null }) => {

    const { scene, gl, camera } = useThree();

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
            // Frequency scaled for larger terrain, amplitude scaled up to maintain hills/valleys
            const noiseInput = vec2(worldPos.x.mul(0.1), worldPos.z.mul(0.1));
            const noiseValue = cnoise(noiseInput);
            const height = noiseValue.mul(10); // Amplify height for larger terrain

            // 6. WRITE BACK TO POSITION BUFFER
            // We update the Y height, but we also update X and Z so the mesh follows the camera
            const finalPos = vec3(worldPos.x, height, worldPos.z);

            positionBuffer.element(index).assign(finalPos);
        })().compute(count);

        const positionNode = Fn(() => {
            return positionBuffer.element(vertexIndex);
        })();

        return {
            nodes: {
                positionNode,
                computeInit,
                computeUpdate,
            },
            uniforms: {
                time,
                uSegmentSize,
                uCameraPosition,
            }
        }

    }, []);

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
        gl.compute(nodes.computeUpdate);
    })


    return (
        <mesh ref={planetMeshRef} frustumCulled={false}>
            <planeGeometry args={[planeWidth, planeHeight, planeWidthSegments, planeHeightSegments]} />
            <meshBasicNodeMaterial
                positionNode={nodes.positionNode}
                side={THREE.DoubleSide}
                color="cyan"
                wireframe={true}
            />
        </mesh>
    )
}

export default Planet;