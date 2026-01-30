import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';

/**
 * MouseAnchorController - Applies gentle force to anchor toward mouse cursor position
 * 
 * Raycasts from mouse to a horizontal plane at anchor height, then applies
 * an attractive force that guides (but doesn't override) the physics-based swing.
 * 
 * @param {object} anchorRef - Ref to the anchor RigidBody
 * @param {boolean} enabled - Whether mouse control is active
 * @param {number} attractStrength - Force magnitude (default: 5)
 * @param {number} deadZone - Distance within which no force is applied (default: 1)
 * @param {number} maxForceDistance - Distance at which force is at maximum (default: 20)
 */
function MouseAnchorController({
    anchorRef,
    enabled = true,
    attractStrength = 5,
    deadZone = 1,
    maxForceDistance = 20,
}) {
    const { camera, pointer, raycaster } = useThree();

    // Reusable objects to avoid GC
    const state = useMemo(() => ({
        groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
        targetPoint: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        anchorPos: new THREE.Vector3(),
    }), []);

    // Visual indicator for mouse target (optional debug)
    const indicatorRef = useRef();

    useFrame((frameState, delta) => {
        if (!enabled || !anchorRef?.current) return;

        // Get RigidBody - handle both direct ref and imperative handle
        const anchor = anchorRef.current.getRigidBody
            ? anchorRef.current.getRigidBody()
            : anchorRef.current;

        if (!anchor || !anchor.translation) return;

        const anchorTranslation = anchor.translation();

        // Update plane height to match anchor
        state.groundPlane.constant = -anchorTranslation.y;

        // Raycast from mouse through camera to the plane
        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.ray.intersectPlane(state.groundPlane, state.targetPoint);

        if (!intersects) return;

        // Update indicator position if it exists
        if (indicatorRef.current) {
            indicatorRef.current.position.copy(state.targetPoint);
        }

        // Calculate direction from anchor to target
        state.anchorPos.set(anchorTranslation.x, anchorTranslation.y, anchorTranslation.z);
        state.direction.subVectors(state.targetPoint, state.anchorPos);
        state.direction.y = 0; // Keep force horizontal

        const distance = state.direction.length();

        // Dead zone - no force when cursor is very close to anchor
        if (distance < deadZone) return;

        state.direction.normalize();

        // Force calculation:
        // - Ramps up from dead zone to max distance
        // - Capped at attractStrength
        const normalizedDist = Math.min((distance - deadZone) / maxForceDistance, 1);
        const forceMagnitude = normalizedDist * attractStrength;

        // Apply impulse (force * delta for frame-rate independence)
        anchor.applyImpulse({
            x: state.direction.x * forceMagnitude * delta,
            y: 0,
            z: state.direction.z * forceMagnitude * delta
        }, true);
    });

    // Optional: Visual indicator of mouse target point
    // Uncomment to debug mouse position
    // return (
    //     <mesh ref={indicatorRef}>
    //         <sphereGeometry args={[0.3, 8, 8]} />
    //         <meshBasicMaterial color="#00ff00" wireframe />
    //     </mesh>
    // );

    return null;
}

export default MouseAnchorController;
