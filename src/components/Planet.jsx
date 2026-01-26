import { useFrame, extend, useThree } from "@react-three/fiber";
import React, { useMemo, useEffect, useCallback, useRef } from "react";
import * as THREE from 'three/webgpu';

import {
    uniform, float, vec3, vec2,
    storage, instanceIndex, vertexIndex, instancedArray, Fn,
} from "three/tsl"

import { cnoise } from "./Perlin"

extend(THREE);

const Planet = () => {

    const { scene, gl } = useThree();

    const planeWidth = 10;
    const planeHeight = 10;
    const planeWidthSegments = 100;
    const planeHeightSegments = 100;

    const planetMeshRef = useRef();

    const count = (planeWidthSegments + 1) * (planeHeightSegments + 1)

    // Initialize storage buffer with plane data
    const positionStorageAttribute = useMemo(() => {
        const tempGeom = new THREE.PlaneGeometry(planeWidth, planeHeight, planeWidthSegments, planeHeightSegments);

        const initialData = tempGeom.attributes.position.array;

        const buffer = new THREE.StorageBufferAttribute(initialData, 3);

        return buffer;
    }, []);

    const { nodes, uniforms } = useMemo(() => {

        const positionBuffer = storage(positionStorageAttribute, 'vec3', count);
        const time = uniform(0);

        const computeInit = Fn(() => {
            // Wrap storage buffer in TSL storage node    
            // const positionBuffer = storage(positionStorageAttribute, 'vec3', count);
        })().compute(count);

        const computeUpdate = Fn(() => {
            const index = instanceIndex;
            const currentPos = positionBuffer.element(index);

            const x = currentPos.x;
            const y = currentPos.y;

            const wave = x.add(time).sin().mul(0.5);

            const z = cnoise(vec2(y.mul(0.5), x.mul(0.5)));

            // const inc = currentPos.z.add(float(index));

            // currentPos.z.assign(wave);
            currentPos.z.assign(z);
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
        const { clock, gl } = state;

        uniforms.time.value = clock.getElapsedTime();
        gl.compute(nodes.computeUpdate);
    })


    return (
        <mesh ref={planetMeshRef}>
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