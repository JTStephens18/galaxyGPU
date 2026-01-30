import { useRef, useCallback, createContext, useContext } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';

/**
 * GameJuice - Screen shake, hitstop, and slow-mo effects
 * 
 * Provides hooks and a processor component for "game feel" effects.
 * Use the useGameJuice hook to trigger effects, and include
 * <GameJuiceProcessor /> in your scene to apply them.
 */

// Global state for juice effects (singleton pattern for simplicity)
const juiceState = {
    // Hitstop - freezes the game briefly
    hitstopRemaining: 0,

    // Screen shake
    shakeIntensity: 0,
    shakeDuration: 0,
    shakeDecay: 0.9, // How quickly shake fades

    // Slow motion
    slowMoFactor: 1,
    slowMoRemaining: 0,
    slowMoTarget: 1,
};

// Context for sharing juice functions
const GameJuiceContext = createContext(null);

/**
 * Hook to access game juice trigger functions
 */
export function useGameJuice() {
    const context = useContext(GameJuiceContext);

    // Fallback if used outside provider (still works, just creates new functions)
    const triggerHitstop = useCallback((duration = 0.08) => {
        juiceState.hitstopRemaining = Math.max(juiceState.hitstopRemaining, duration);
    }, []);

    const triggerShake = useCallback((intensity = 0.3, duration = 0.15) => {
        juiceState.shakeIntensity = Math.max(juiceState.shakeIntensity, intensity);
        juiceState.shakeDuration = Math.max(juiceState.shakeDuration, duration);
    }, []);

    const triggerSlowMo = useCallback((factor = 0.2, duration = 0.3) => {
        juiceState.slowMoFactor = factor;
        juiceState.slowMoTarget = factor;
        juiceState.slowMoRemaining = duration;
    }, []);

    // Combined effect for regular hits
    const triggerHitEffect = useCallback((damage = 1) => {
        const intensity = Math.min(0.1 + damage * 0.1, 0.5);
        triggerHitstop(0.03 + damage * 0.02);
        triggerShake(intensity, 0.1 + damage * 0.05);
    }, [triggerHitstop, triggerShake]);

    // Big effect for kills
    const triggerKillEffect = useCallback(() => {
        triggerHitstop(0.1);
        triggerShake(0.5, 0.2);
        triggerSlowMo(0.3, 0.25);
    }, [triggerHitstop, triggerShake, triggerSlowMo]);

    return context || {
        triggerHitstop,
        triggerShake,
        triggerSlowMo,
        triggerHitEffect,
        triggerKillEffect,
    };
}

/**
 * Component that applies juice effects each frame
 * Include this once in your scene
 */
export function GameJuiceProcessor() {
    const { camera } = useThree();
    const baseCamPos = useRef(new THREE.Vector3());
    const isShaking = useRef(false);
    const originalCamPos = useRef(new THREE.Vector3());

    useFrame((state, delta) => {
        // === HITSTOP ===
        if (juiceState.hitstopRemaining > 0) {
            juiceState.hitstopRemaining -= delta;
            // Note: To actually pause physics, you'd need to integrate with Rapier's timeStep
            // For now, this just tracks the state
        }

        // === SCREEN SHAKE ===
        if (juiceState.shakeDuration > 0) {
            // Save original position on first shake frame
            if (!isShaking.current) {
                originalCamPos.current.copy(camera.position);
                isShaking.current = true;
            }

            // Apply random offset based on intensity
            const offsetX = (Math.random() - 0.5) * 2 * juiceState.shakeIntensity;
            const offsetY = (Math.random() - 0.5) * 2 * juiceState.shakeIntensity;

            camera.position.x = originalCamPos.current.x + offsetX;
            camera.position.y = originalCamPos.current.y + offsetY;

            // Decay shake
            juiceState.shakeDuration -= delta;
            juiceState.shakeIntensity *= juiceState.shakeDecay;

        } else if (isShaking.current) {
            // Restore original position when shake ends
            camera.position.x = originalCamPos.current.x;
            camera.position.y = originalCamPos.current.y;
            isShaking.current = false;
            juiceState.shakeIntensity = 0;
        }

        // === SLOW MOTION ===
        if (juiceState.slowMoRemaining > 0) {
            juiceState.slowMoRemaining -= delta;

            if (juiceState.slowMoRemaining <= 0) {
                // Lerp back to normal time
                juiceState.slowMoFactor = 1;
                juiceState.slowMoTarget = 1;
            }
        }
    });

    return null;
}

/**
 * Get current time scale for physics/animations
 * Call this in your game loop to get the adjusted delta
 */
export function getTimeScale() {
    if (juiceState.hitstopRemaining > 0) {
        return 0; // Complete freeze during hitstop
    }
    return juiceState.slowMoFactor;
}

/**
 * Check if currently in hitstop
 */
export function isInHitstop() {
    return juiceState.hitstopRemaining > 0;
}

export default GameJuiceProcessor;
