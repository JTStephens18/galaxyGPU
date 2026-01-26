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

const STAR_COUNT = 1_000;

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
        const velocityBuffer = instancedArray(STAR_COUNT, 'vec3');
        const originalPositionBuffer = instancedArray(STAR_COUNT, 'vec3');
        const densityFactorBuffer = instancedArray(STAR_COUNT, 'float');

        // ==========

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

        // ========= 

        //         const hash = Fn(([seed]) => {
        //     const h = seed.fract().mul(0.1031);
        //     return h.mul(h.add(33.33)).mul(h.add(h)).fract();
        // });

        const rotateXZ = Fn(([p, angle]) => {
            const cosA = cos(angle);
            const sinA = sin(angle);
            return vec3(
                p.x.mul(cosA).sub(p.z.mul(sinA)),
                p.y,
                p.x.mul(sinA).add(p.z.mul(cosA))
            );
        });

        const computeGalaxyInit = Fn(() => {
            const idx = uint(instanceIndex);
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

        const computeGalaxyUpdate = Fn(() => {

            const idx = instanceIndex;

            // Read current position from buffers

            const position = positionBuffer.element(idx).toVar();
            console.log("Position ", position);
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


        const galaxyColorNode = Fn(() => {
            const densityFactor = densityFactorBuffer.element(instanceIndex);

            // B. Procedural Circle (Fix: uv() is a function)
            // const dist = uv().sub(0.5).length().mul(2.0);

            // D. Color mixing
            const denseColor = vec3(0.4, 0.6, 1.0);
            const sparseColor = vec3(1.0, 0.6, 0.3);
            const starColor = mix(denseColor, sparseColor, densityFactor);
            return starColor;
        })();

        const galaxyOpacityNode = Fn(() => {
            const dist = uv().sub(0.5).length().mul(2.0);
            return smoothstep(1.0, 0.6, dist);
        })();

        const randValue = Fn(([min, max, seed]) => {
            return hash(seed).mul(max.sub(min)).add(min);
        });

        const scaleNode = Fn(() => {
            return randValue(0.005, 0.01, 3);
        })();

        const galaxyScaleNode = Fn(() => {
            return uniform(0.8);
        })();

        return {
            nodes: {
                positionNode,
                colorNode,
                galaxyColorNode,
                scaleNode,
                galaxyScaleNode,
                galaxyOpacityNode,
                computeInit,
                computeGalaxyInit,
                computeGalaxyUpdate,
            },
            uniforms: {

            },
        };
    }, []);

    const compute = useCallback(async () => {
        try {
            // await gl.computeAsync(nodes.computeInit);
            await gl.computeAsync(nodes.computeGalaxyInit);
        } catch (error) {
            console.error(error);
        }
    });

    useEffect(() => {
        compute();
    }, [compute]);

    useFrame(() => {
        // const { gl } = state;
        gl.compute(nodes.computeGalaxyUpdate);
    })

    return (
        <>
            <sprite count={STAR_COUNT}>
                <spriteNodeMaterial
                    colorNode={nodes.galaxyColorNode}
                    positionNode={nodes.positionNode}
                    scaleNode={nodes.galaxyScaleNode}
                    opacityNode={nodes.galaxyOpacityNode}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </sprite>
        </>
    );
};

export default Spiral;