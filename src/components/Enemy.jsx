import { useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import * as THREE from 'three/webgpu';

/**
 * Enemy - A basic test enemy for combat system validation
 * 
 * Features:
 * - Health system with damage flash
 * - Exposes position for aim assist targeting
 * - Callbacks for hit and death events
 * 
 * @param {number[]} position - Initial spawn position [x, y, z]
 * @param {number} health - Starting health points
 * @param {function} onDeath - Called when health reaches 0
 * @param {function} onHit - Called when taking damage
 * @param {string} color - Base color of the enemy
 */
const Enemy = forwardRef(function Enemy({
    position = [0, 5, -15],
    health = 3,
    onDeath = null,
    onHit = null,
    color = '#ff4444',
    size = 1,
}, ref) {
    const rbRef = useRef();
    const meshRef = useRef();
    const [currentHealth, setCurrentHealth] = useState(health);
    const [isAlive, setIsAlive] = useState(true);
    const flashTimer = useRef(0);

    // Expose methods and state to parent
    useImperativeHandle(ref, () => ({
        // Get current world position
        getPosition: () => {
            if (rbRef.current) {
                const pos = rbRef.current.translation();
                return new THREE.Vector3(pos.x, pos.y, pos.z);
            }
            return new THREE.Vector3(...position);
        },
        // Get rigid body ref for collision detection
        getRigidBody: () => rbRef.current,
        // Take damage
        takeDamage: (damage = 1) => {
            if (!isAlive) return;

            const newHealth = Math.max(0, currentHealth - damage);
            setCurrentHealth(newHealth);
            flashTimer.current = 0.15; // Flash duration

            if (onHit) {
                onHit(damage, newHealth);
            }

            if (newHealth <= 0) {
                setIsAlive(false);
                if (onDeath) {
                    const pos = rbRef.current?.translation();
                    onDeath(pos ? { x: pos.x, y: pos.y, z: pos.z } : null);
                }
            }
        },
        // Check if alive
        isAlive: () => isAlive,
        // Get current health
        getHealth: () => currentHealth,
    }));

    // Update flash effect
    useFrame((state, delta) => {
        if (flashTimer.current > 0) {
            flashTimer.current -= delta;

            // Flash white when hit
            if (meshRef.current) {
                const flash = flashTimer.current > 0;
                meshRef.current.material.color.set(flash ? '#ffffff' : color);
            }
        }
    });

    // Don't render if dead
    if (!isAlive) return null;

    return (
        <RigidBody
            ref={rbRef}
            type="dynamic"
            position={position}
            gravityScale={0}
            linearDamping={2}
            angularDamping={2}
            colliders="cuboid"
        >
            <mesh ref={meshRef}>
                <boxGeometry args={[size, size, size]} />
                <meshBasicMaterial color={color} wireframe />
            </mesh>

            {/* Health indicator - small bar above enemy */}
            <group position={[0, size * 0.8, 0]}>
                {/* Background */}
                <mesh position={[0, 0, 0]}>
                    <planeGeometry args={[size, 0.1]} />
                    <meshBasicMaterial color="#333333" side={THREE.DoubleSide} />
                </mesh>
                {/* Health fill */}
                <mesh position={[(currentHealth / health - 1) * size * 0.5, 0, 0.01]}>
                    <planeGeometry args={[size * (currentHealth / health), 0.08]} />
                    <meshBasicMaterial color="#00ff00" side={THREE.DoubleSide} />
                </mesh>
            </group>
        </RigidBody>
    );
});

export default Enemy;
