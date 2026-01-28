import { useRef, forwardRef } from 'react';
import * as THREE from 'three/webgpu';

/**
 * Player mesh component - a simple capsule representing the airship
 */
const Player = forwardRef(function Player({ bobOffset = 0 }, ref) {
    return (
        <group ref={ref}>
            {/* Capsule mesh offset by bobOffset for visual bobbing */}
            <mesh position={[0, bobOffset, 0]}>
                <capsuleGeometry args={[0.3, 0.8, 4, 16]} />
                <meshBasicMaterial color="#00ffff" wireframe />
            </mesh>
        </group>
    );
});

export default Player;
