import { Sphere } from "@react-three/drei";
import { useFrame, useThree, spr } from "@react-three/fiber";
import React, { useMemo, useState } from "react";
import { MathUtils } from "three";
import * as THREE from 'three/webgpu'

import {
    Fn, float, vec2, vec3, sin, cos,
    instancedArray, instanceIndex, uniform, storage,
    texture, uv, smoothstep, mix
} from 'three/tsl'

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

    const armCount = 4;
    const galaxyRadius = 50.0;
    const spiralTightness = 2.0;
    const armWidth = 8.0;
    const thickness = 5.0;
    const randomness = 5.0;

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

const Galaxy = () => {

    // Convert storage bugger to vertex attribute
    const starPos = positionBuffer.toAttribute();
    const densityFactor = densityFactorBuffer.toAttribute();

    // Create sprite material
    const spriteMaterial = new THREE.SpriteNodeMaterial();

    spriteMaterial.positionNode = starPos;

    const dist = uv.sub(0.5).length().mul(2.0);
    const circleShape = smoothStep(1.0, 0.5, dist);

    const denseColor = vec3(0.4, 0.6, 1.0);  // Blue
    const sparseColor = vec3(1.0, 0.6, 0.3); // Orange
    const starColor = mix(denseColor, sparseColor, densityFactor);

    spriteMaterial.colorNode = starColor;
    spriteMaterial.opacityNode = circleShape;
    spriteMaterial.scaleNode = uniform(0.8); // Particle size

    // Additive blending for glow effect
    spriteMaterial.blending = THREE.AdditiveBlending;
    spriteMaterial.transparent = true;
    spriteMaterial.depthWrite = false;

    return (
        <instancedMesh ref={meshRef} args={[null, null, STAR_COUNT]}>
            {/* Use PlaneGeometry to mimic a Sprite */}
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color="white" />
        </instancedMesh>
    );
}

export default Galaxy;