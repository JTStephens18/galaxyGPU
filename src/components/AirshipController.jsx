import { useRef, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import Player from './Player';
import Anchor from './Anchor';
import MouseAnchorController from './MouseAnchorController';
import { GameJuiceProcessor, useGameJuice } from './GameJuice';
import Enemy from './Enemy';

/**
 * AirshipController - Hovercraft-style movement controller
 * 
 * Controls a floating capsule with smooth camera follow, inertia-based movement,
 * and visual bobbing effect.
 * 
 * @param {number} baseSpeed - Movement units per second (default: 10)
 * @param {number} sprintMult - Sprint speed multiplier (default: 2)
 * @param {number} turnSpeed - Rotation speed for facing direction (default: 5)
 * @param {number[]} camOffset - Camera offset [x, y, z] from player (default: [0, 5, 10])
 * @param {number} smoothTime - Damping factor for movement inertia (default: 0.2)
 * @param {boolean} debug - When true, disables camera control (for OrbitControls)
 * @param {function} onPositionUpdate - Callback with player position for terrain following
 */
function AirshipController({
    baseSpeed = 10,
    sprintMult = 2,
    turnSpeed = 5,
    camOffset = [0, 5, 10],
    smoothTime = 0.2,
    debug = false,
    onPositionUpdate = null,
}) {
    const rbRef = useRef();
    const playerRef = useRef();
    const arrowRef = useRef();
    const anchorRef = useRef();
    const enemyRefs = useRef([]);
    const camera = useThree((state) => state.camera);

    // Game juice hooks
    const { triggerHitEffect, triggerKillEffect } = useGameJuice();

    // Get keyboard input state
    const [, getKeys] = useKeyboardControls();

    // Leva controls for chain length
    const {
        chainRestLength,
        chainMinLength,
        chainMaxLength,
        reelSpeed,
        extendSpeed,
    } = useControls('Chain Controls', {
        chainRestLength: { value: 6, min: 2, max: 15, step: 0.5 },
        chainMinLength: { value: 2, min: 1, max: 5, step: 0.5 },
        chainMaxLength: { value: 12, min: 8, max: 25, step: 1 },
        reelSpeed: { value: 8, min: 1, max: 20, step: 1 },
        extendSpeed: { value: 15, min: 5, max: 30, step: 1 },
    });

    // Leva controls for anchor physics
    const {
        anchorMass,
        anchorRadius,
        springStiffness,
        springDamping,
        gravityStrength,
        trailLength,
        chainSegmentCount,
    } = useControls('Anchor Physics', {
        anchorMass: { value: 5, min: 1, max: 20, step: 0.5 },
        anchorRadius: { value: 0.5, min: 0.2, max: 2, step: 0.1 },
        springStiffness: { value: 80, min: 10, max: 200, step: 5 },
        springDamping: { value: 8, min: 0, max: 30, step: 1 },
        gravityStrength: { value: 20, min: 0, max: 50, step: 1 },
        trailLength: { value: 6, min: 0, max: 12, step: 1 },
        chainSegmentCount: { value: 10, min: 4, max: 20, step: 1 },
    });

    // Leva controls for flight limits
    const {
        minHeight,
        maxHeight,
        verticalSpeed,
    } = useControls('Flight Limits', {
        minHeight: { value: 3, min: 0, max: 20, step: 1 },
        maxHeight: { value: 20, min: 20, max: 200, step: 5 },
        verticalSpeed: { value: 8, min: 1, max: 20, step: 1 },
    });

    // Leva controls for mouse aiming
    const {
        enableMouseAim,
        mouseAttractStrength,
        aimAssistStrength,
        aimAssistRange,
    } = useControls('Mouse Aiming', {
        enableMouseAim: { value: true },
        mouseAttractStrength: { value: 5, min: 0, max: 20, step: 1 },
        aimAssistStrength: { value: 3, min: 0, max: 10, step: 0.5 },
        aimAssistRange: { value: 5, min: 2, max: 15, step: 1 },
    });

    // Current chain length state
    const [chainLength, setChainLength] = useState(6);

    // Mutable state for smoothing (avoid re-renders)
    const state = useMemo(() => ({
        currentVelocity: new THREE.Vector3(),
        targetVelocity: new THREE.Vector3(),
        currentRotation: new THREE.Quaternion(),
        targetRotation: new THREE.Quaternion(),
        cameraTargetPos: new THREE.Vector3(),
        cameraLookTarget: new THREE.Vector3(), // Smoothed lookAt target
        inputDirection: new THREE.Vector3(),
        // Track facing direction separately from movement
        facingDirection: new THREE.Vector3(0, 0, -1),
        facingAngle: 0,
        // Reusable temp vectors
        tempVec3: new THREE.Vector3(),
        tempEuler: new THREE.Euler(),
    }), []);

    // Bobbing animation time
    const bobTime = useRef(0);

    useFrame((frameState, delta) => {
        if (!rbRef.current) return;

        const { forward, backward, left, right, sprint, lasso, ascend, descend } = getKeys();
        const rb = rbRef.current;

        // === CHAIN LENGTH CONTROL (Lasso/Whip) ===
        if (lasso) {
            // Reel in - shorten chain
            setChainLength(prev => Math.max(prev - reelSpeed * delta, chainMinLength));
        } else {
            // Extend back to rest length (or max if whipping)
            setChainLength(prev => {
                if (prev < chainRestLength) {
                    return Math.min(prev + extendSpeed * delta, chainRestLength);
                }
                return prev;
            });
        }

        // Get current position from physics body
        const position = rb.translation();
        const playerPos = new THREE.Vector3(position.x, position.y, position.z);

        // === A. ROTATION (A/D keys) ===
        // A/D rotate the ship left/right
        if (left) {
            state.facingAngle += turnSpeed * delta;  // Turn left
        }
        if (right) {
            state.facingAngle -= turnSpeed * delta;  // Turn right
        }

        // Apply rotation
        state.targetRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.facingAngle);
        state.currentRotation.copy(state.targetRotation);
        rb.setRotation(state.currentRotation, true);

        // Calculate facing direction (forward is -Z in local space, rotated by facing angle)
        state.facingDirection.set(0, 0, -1).applyQuaternion(state.currentRotation);

        // === B. MOVEMENT (W/S keys) ===
        // W = move forward (in facing direction), S = move backward
        let moveAmount = 0;
        if (forward) moveAmount = 1;   // Forward
        if (backward) moveAmount = -1; // Backward

        const speed = sprint ? baseSpeed * sprintMult : baseSpeed;

        // Target velocity is facing direction * move amount * speed
        state.targetVelocity.copy(state.facingDirection).multiplyScalar(moveAmount * speed);

        // Smooth velocity transition (inertia effect)
        const dampFactor = 1 - Math.exp(-delta / smoothTime);
        state.currentVelocity.lerp(state.targetVelocity, dampFactor);

        // Apply velocity to physics body
        // Calculate vertical velocity with height clamping
        let verticalVel = 0;
        const currentY = position.y;

        if (ascend && currentY < maxHeight) {
            verticalVel = verticalSpeed;
        } else if (descend && currentY > minHeight) {
            verticalVel = -verticalSpeed;
        }

        // Clamp position if at limits
        if (currentY >= maxHeight && verticalVel > 0) verticalVel = 0;
        if (currentY <= minHeight && verticalVel < 0) verticalVel = 0;

        rb.setLinvel({
            x: state.currentVelocity.x,
            y: verticalVel,
            z: state.currentVelocity.z
        }, true);

        // === E. VISUAL BOBBING ===
        bobTime.current += delta;
        const bobAmount = Math.sin(bobTime.current * 3) * 0.1; // Amplitude 0.1, frequency 3

        // Update player mesh position for bobbing (visual only)
        if (playerRef.current) {
            playerRef.current.position.y = bobAmount;
        }

        // Arrow direction is handled by parent RigidBody rotation
        // No need to manually update it

        // === F. CAMERA FOLLOW ===
        if (!debug) {
            // Calculate target camera position (behind and above player)
            const offset = new THREE.Vector3(...camOffset);
            // Rotate offset by player's rotation
            offset.applyQuaternion(state.currentRotation);
            state.cameraTargetPos.copy(playerPos).add(offset);

            // Use high smoothing factor for tight follow (reduces jitter)
            const smoothFactor = 1 - Math.exp(-delta * 10);
            camera.position.lerp(state.cameraTargetPos, smoothFactor);

            // Smooth the lookAt target as well to prevent snapping
            state.cameraLookTarget.lerp(playerPos, smoothFactor);
            camera.lookAt(state.cameraLookTarget);
        }

        // === G. NOTIFY TERRAIN ===
        if (onPositionUpdate) {
            onPositionUpdate(playerPos);
        }
    });

    return (
        <>
            <RigidBody
                ref={rbRef}
                type="dynamic"
                position={[0, 10, 0]}
                enabledRotations={[false, true, false]}
                linearDamping={0}
                angularDamping={0}
                gravityScale={0}
            >
                <Player ref={playerRef} />
                {/* Direction arrow helper */}
                <arrowHelper
                    ref={arrowRef}
                    args={[
                        new THREE.Vector3(0, 0, -1), // direction
                        new THREE.Vector3(0, 0, 0),  // origin
                        1,                            // length
                        0x00ff00,                     // color (green)
                        0.2,                          // headLength
                        0.1                           // headWidth
                    ]}
                />
            </RigidBody>

            {/* Wrecking Ball Anchor */}
            <Anchor
                ref={anchorRef}
                shipRef={rbRef}
                chainLength={chainLength}
                anchorMass={anchorMass}
                anchorRadius={anchorRadius}
                springStiffness={springStiffness}
                springDamping={springDamping}
                gravityStrength={gravityStrength}
                trailLength={trailLength}
                chainSegmentCount={chainSegmentCount}
                enemies={enemyRefs.current.filter(e => e?.isAlive?.())}
                aimAssistStrength={aimAssistStrength}
                aimAssistRange={aimAssistRange}
            />

            {/* Mouse-guided anchor control */}
            <MouseAnchorController
                anchorRef={anchorRef}
                enabled={enableMouseAim}
                attractStrength={mouseAttractStrength}
            />

            {/* Game Juice Processor (screen shake, hitstop) */}
            <GameJuiceProcessor />

            {/* Test Enemies */}
            <Enemy
                ref={(el) => (enemyRefs.current[0] = el)}
                position={[5, 5, -10]}
                health={3}
                onHit={(damage) => triggerHitEffect(damage)}
                onDeath={() => triggerKillEffect()}
            />
            <Enemy
                ref={(el) => (enemyRefs.current[1] = el)}
                position={[-8, 5, -15]}
                health={5}
                color="#ff8844"
                onHit={(damage) => triggerHitEffect(damage)}
                onDeath={() => triggerKillEffect()}
            />
            <Enemy
                ref={(el) => (enemyRefs.current[2] = el)}
                position={[0, 5, -20]}
                health={4}
                color="#ff44aa"
                size={1.5}
                onHit={(damage) => triggerHitEffect(damage)}
                onDeath={() => triggerKillEffect()}
            />
        </>
    );
}

export default AirshipController;
