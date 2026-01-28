import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three/webgpu';
import Player from './Player';

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
    const camera = useThree((state) => state.camera);

    // Get keyboard input state
    const [, getKeys] = useKeyboardControls();

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

        const { forward, backward, left, right, sprint } = getKeys();
        const rb = rbRef.current;

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

        // Apply velocity to physics body (keep Y at 0 for flat movement)
        rb.setLinvel({
            x: state.currentVelocity.x,
            y: 0,
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
        <RigidBody
            ref={rbRef}
            type="dynamic"
            position={[0, 1, 0]}
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
    );
}

export default AirshipController;

