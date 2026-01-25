import { useFrame, extend, useThree } from "@react-three/fiber";
import React, { useMemo, useEffect, useCallback } from "react";
import * as THREE from 'three/webgpu';
import { SpriteNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';

// 1. Ensure all TSL functions are imported
import {
    Fn, float, int, uint, vec2, vec3, vec4, sin, cos,
    sqrt, min, fract, distance, hash,
    instancedArray, instanceIndex, uniform,
    texture, uv, smoothstep, mix, length, billboarding,
    compute
} from 'three/tsl';

extend(THREE);

const STAR_COUNT = 1_000_000;

const Spiral = () => {

    const { scene, gl } = useThree();

    useEffect(() => {
        const dirLight = new THREE.DirectionalLight(0xffffff, 4.0);
        dirLight.position.set(10, 10, 10);
        scene.add(dirLight);
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
    }, []);

    const { nodes, uniforms } = useMemo(() => {

        const positionBuffer = instancedArray(STAR_COUNT, 'vec3');
        const offsetPositionBuffer = instancedArray(STAR_COUNT, 'vec3');

        // const hash = Fn(([idx]) => {
        //     return fract(sin(idx).mul(12.9898).mul(43758.5453));
        // })();

        const computeInit = Fn(() => {
            const idx = uint(instanceIndex);

            let h0 = hash(idx);
            let h1 = hash(idx.add(1));
            let h2 = hash(idx.add(2));

            let distance = sqrt(h0.mul(4.0));
            let theta = h1.mul(6.28318530718); // 2 * PI
            let phi = h2.mul(3.14159265359); // PI

            let x = distance.mul(sin(phi).mul(cos(theta)));
            let y = distance.mul(sin(phi).mul(sin(theta)));
            let z = distance.mul(cos(phi));

            const position = vec3(x, y, z);
            positionBuffer.element(idx).assign(position);
        })().compute(STAR_COUNT);

        const positionNode = Fn(() => {
            return positionBuffer.element(instanceIndex);
        })();

        const colorNode = Fn(() => {

            const position = positionBuffer.element(instanceIndex);
            const uvCoord = uv();

            let color = vec3(0.24, 0.43, 0.96);
            let distanceToCenter = min(
                distance(position, vec3(0.0, 0.0, 0.0)),
                2.75
            );

            let strength = distance(uvCoord, vec2(0.5));

            let distColor = mix(
                vec3(0.97, 0.7, 0.45),
                color,
                distanceToCenter.mul(0.4)
            );

            let fillMask = float(1.0).sub(strength).mul(2.0);
            let finalColor = mix(vec3(0.0), distColor, fillMask);

            let circle = smoothstep(0.5, 0.49, strength);
            return vec4(finalColor.mul(circle), 1.0);
        })();

        const randValue = Fn(([min, max, seed]) => {
            return hash(seed).mul(max.sub(min)).add(min);
        });

        const scaleNode = Fn(() => {
            return randValue(0.005, 0.01, 3);
        })();

        return {
            nodes: {
                positionNode,
                colorNode,
                scaleNode,
                computeInit,
            },
            uniforms: {

            },
        };
    }, []);

    const compute = useCallback(async () => {
        try {
            await gl.computeAsync(nodes.computeInit);
        } catch (error) {
            console.error(error);
        }
    });

    useEffect(() => {
        compute();
    }, [compute]);

    return (
        <>
            <sprite count={STAR_COUNT}>
                <spriteNodeMaterial
                    colorNode={nodes.colorNode}
                    positionNode={nodes.positionNode}
                    scaleNode={nodes.scaleNode}
                    // opacityNode={opacityNode}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </sprite>
        </>
    );
};

export default Spiral;