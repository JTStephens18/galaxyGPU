import { useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three/webgpu';

/**
 * Anchor - A heavy wrecking ball attached to the player's ship via spring constraint
 * 
 * The anchor hangs below the ship and swings based on the player's rotation
 * and movement, creating a momentum-based melee weapon.
 * 
 * Instead of Rapier joints (which don't update dynamically), we use a custom
 * spring constraint applied in useFrame.
 */
const Anchor = forwardRef(function Anchor({
    shipRef,
    chainLength = 6,
    anchorMass = 5,
    anchorRadius = 0.5,
    springStiffness = 50,
    springDamping = 5,
    gravityStrength = 15,
    trailLength = 6,
    trailOpacityFalloff = 0.6,
    chainSegmentCount = 10,
}, ref) {
    const anchorRef = useRef();

    // Expose anchor ref to parent
    useImperativeHandle(ref, () => anchorRef.current);

    // Trail buffer for ghost effect (stable ref, not state)
    const trailBuffer = useRef([]);

    // Mutable state to avoid re-renders
    const state = useMemo(() => ({
        tempVec3: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
    }), []);

    useFrame((frameState, delta) => {
        if (!anchorRef.current || !shipRef.current) return;

        const anchor = anchorRef.current;
        const ship = shipRef.current;

        // Get positions
        const anchorPos = anchor.translation();
        const shipPos = ship.translation();

        // === SPRING CONSTRAINT: Keep anchor within chainLength ===
        // Calculate vector from ship to anchor
        state.direction.set(
            anchorPos.x - shipPos.x,
            anchorPos.y - shipPos.y,
            anchorPos.z - shipPos.z
        );

        const distance = state.direction.length();

        // If stretched beyond chain length, apply spring force
        if (distance > chainLength) {
            state.direction.normalize();

            // Spring force pulls anchor toward max distance
            const stretch = distance - chainLength;
            const springForce = -stretch * springStiffness;

            // Get current velocity for damping
            const vel = anchor.linvel();
            const radialVelocity = vel.x * state.direction.x +
                vel.y * state.direction.y +
                vel.z * state.direction.z;
            const dampingForce = -radialVelocity * springDamping;

            const totalForce = springForce + dampingForce;

            anchor.applyImpulse({
                x: state.direction.x * totalForce * delta,
                y: state.direction.y * totalForce * delta,
                z: state.direction.z * totalForce * delta,
            }, true);
        }

        // === GRAVITY: Pull anchor down ===
        anchor.applyImpulse({ x: 0, y: -gravityStrength * delta, z: 0 }, true);

        // === UPDATE TRAIL BUFFER ===
        trailBuffer.current.unshift({
            x: anchorPos.x,
            y: anchorPos.y,
            z: anchorPos.z,
        });
        if (trailBuffer.current.length > trailLength) {
            trailBuffer.current.pop();
        }
    });

    return (
        <>
            {/* Anchor RigidBody */}
            <RigidBody
                ref={anchorRef}
                type="dynamic"
                position={[0, 8, 0]} // Start below ship (ship is at y=10)
                mass={anchorMass}
                linearDamping={0.3}
                angularDamping={0.5}
                colliders="ball"
                gravityScale={0} // We apply our own gravity
            >
                {/* Icosahedron mesh for PS1 aesthetic */}
                <mesh>
                    <icosahedronGeometry args={[anchorRadius, 1]} />
                    <meshBasicMaterial color="#ffcc00" wireframe />
                </mesh>
            </RigidBody>

            {/* Chain Segments (visual only) */}
            <ChainVisual
                shipRef={shipRef}
                anchorRef={anchorRef}
                segmentCount={chainSegmentCount}
            />

            {/* Ghost Trail */}
            <GhostTrail
                trailBuffer={trailBuffer}
                anchorRadius={anchorRadius}
                opacityFalloff={trailOpacityFalloff}
            />
        </>
    );
});

/**
 * ChainVisual - Renders chain segments between ship and anchor
 */
function ChainVisual({ shipRef, anchorRef, segmentCount }) {
    const segmentsRef = useRef([]);

    useFrame(() => {
        if (!shipRef.current || !anchorRef.current) return;

        const shipPos = shipRef.current.translation();
        const anchorPos = anchorRef.current.translation();

        // Update each segment position
        segmentsRef.current.forEach((segment, i) => {
            if (!segment) return;
            const t = (i + 1) / (segmentCount + 1);
            segment.position.set(
                shipPos.x + (anchorPos.x - shipPos.x) * t,
                shipPos.y + (anchorPos.y - shipPos.y) * t,
                shipPos.z + (anchorPos.z - shipPos.z) * t
            );
        });
    });

    return (
        <>
            {Array.from({ length: segmentCount }).map((_, i) => (
                <mesh
                    key={i}
                    ref={(el) => (segmentsRef.current[i] = el)}
                >
                    <boxGeometry args={[0.08, 0.08, 0.08]} />
                    <meshBasicMaterial color="#888888" wireframe />
                </mesh>
            ))}
        </>
    );
}

/**
 * GhostTrail - Renders fading ghost copies of the anchor
 * Uses a ref-based approach to avoid re-renders
 */
function GhostTrail({ trailBuffer, anchorRadius, opacityFalloff }) {
    const meshRefs = useRef([]);

    useFrame(() => {
        const positions = trailBuffer.current;
        meshRefs.current.forEach((mesh, i) => {
            if (!mesh) return;
            if (i < positions.length) {
                mesh.position.set(positions[i].x, positions[i].y, positions[i].z);
                mesh.visible = true;
            } else {
                mesh.visible = false;
            }
        });
    });

    return (
        <>
            {Array.from({ length: 12 }).map((_, i) => (
                <mesh
                    key={i}
                    ref={(el) => (meshRefs.current[i] = el)}
                    visible={false}
                >
                    <icosahedronGeometry args={[anchorRadius * 0.9, 1]} />
                    <meshBasicMaterial
                        color="#ffcc00"
                        transparent
                        opacity={Math.pow(opacityFalloff, i + 1)}
                        wireframe
                    />
                </mesh>
            ))}
        </>
    );
}

export default Anchor;
