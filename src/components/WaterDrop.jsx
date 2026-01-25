import { OrbitControls } from '@react-three/drei';
import { Canvas, extend, useThree, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three/webgpu';

import {
    Fn,
    vec3,
    float,
    abs,
    dot,
    sub,
    rand,
    max,
    pow,
    length,
    clamp,
    cross,
    add,
    uv,
    texture,
    mix,
    uniform,
    varying,
    viewportUV,
    positionLocal,
    positionWorld,
    normalLocal,
    normalWorld,
    normalize,
    If,
    negate,
    transformNormalToView,
} from 'three/tsl';

import { cnoise } from "./Perlin"

extend(THREE);

const WaterDrop = () => {

    const meshRef = useRef();
    const { scene, gl } = useThree();
    const lightPosition = [10, 10, 10];
    const cameraPosition = uniform(vec3(0, 0, 0));

    const sceneTexture = texture(new THREE.Texture());

    useEffect(() => {
        const dirLight = new THREE.DirectionalLight(0xffffff, 4.0);
        dirLight.position.set(10, 10, 10);
        scene.add(dirLight);
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
    }, []);

    const { backgroundNodes } = useMemo(() => {

        // ====== SphereColorNode ======

        const gradientNode = Fn(() => {
            const color1 = vec3(0.01, 0.22, 0.98);
            const color2 = vec3(0.36, 0.68, 1.0);
            const t = clamp(length(abs(uv().sub(0.5))), 0.0, 0.8);
            return mix(color1, color2, t);
        });

        const sphereColorNode = gradientNode();

        return {
            backgroundNodes: {
                sphereColorNode,
            }
        };

    }, []);

    const { nodes, uniforms } = useMemo(() => {
        const uTime = uniform(0.0);
        const vNormal = varying(vec3(), 'vNormal');

        // ====== PositionNode ======

        const updatePos = Fn(([pos, time]) => {
            const noise = cnoise(vec3(pos).add(vec3(time))).mul(0.2);
            return add(pos, noise);
        });

        const orthogonal = Fn(() => {
            const pos = normalLocal;
            If(abs(pos.x).greaterThan(abs(pos.z)), () => {
                return normalize(vec3(negate(pos.y), pos.x, 0.0));
            });

            return normalize(vec3(0.0, negate(pos.z), pos.y));
        });

        const positionNode = Fn(() => {
            const pos = positionLocal;
            const updatedPos = updatePos(pos, uTime);

            const theta = float(0.001);

            const vecTangent = orthogonal();
            const vecBiTangent = normalize(cross(normalLocal, vecTangent));

            const neighbor1 = pos.add(vecTangent.mul(theta));
            const neighbor2 = pos.add(vecBiTangent.mul(theta));

            const displacedNeighbor1 = updatePos(neighbor1, uTime);
            const displacedNeighbor2 = updatePos(neighbor2, uTime);

            const displacedTangent = displacedNeighbor1.sub(updatedPos);
            const displacedBitangent = displacedNeighbor2.sub(updatedPos);

            const normal = normalize(cross(displacedTangent, displacedBitangent));

            const displacedNormal = normal
                .dot(normalLocal)
                .lessThan(0.0)
                .select(normal.negate(), normal);
            vNormal.assign(displacedNormal);

            return updatedPos;
        })();

        // ====== NormalNode ======

        const normalNode = Fn(() => {
            const normal = vNormal;
            return transformNormalToView(normal);
        })();

        return {
            nodes: {
                positionNode,
                normalNode,
            },
            uniforms: {
                uTime,
                cameraPosition,
                sceneTexture,
            },
        };

    }, []);

    const { utils } = useMemo(() => {

        const classicFresnel = Fn(({ viewVector, worldNormal, power }) => {
            const fresnelFactor = abs(dot(viewVector, worldNormal));
            const inverseFresnelFactor = sub(1.0, fresnelFactor);
            return pow(inverseFresnelFactor, power);
        });

        const sat = Fn(([col]) => {
            const W = vec3(0.2125, 0.7154, 0.0721);
            const intensity = vec3(dot(col, W));
            return mix(intensity, col, 1.265);
        });

        const refractAndDisperse = Fn(({ sceneTex }) => {
            const absorption = 0.5;
            const refractionIntensity = 0.25;
            const shininess = 100.0;
            const LOOP = 8;
            const noiseIntensity = 0.015;

            const refractNormal = normalWorld.xy
                .mul(sub(1.0, normalWorld.z.mul(0.85)))
                .add(0.05);

            const refractCol = vec3(0.0, 0.0, 0.0).toVar();

            for (let i = 0; i < LOOP; i++) {
                const noise = rand(viewportUV).mul(noiseIntensity);
                const slide = float(i).div(float(LOOP)).mul(0.18).add(noise);

                const refractUvR = viewportUV.sub(
                    refractNormal
                        .mul(slide.mul(1.0).add(refractionIntensity))
                        .mul(absorption)
                );
                const refractUvG = viewportUV.sub(
                    refractNormal
                        .mul(slide.mul(2.5).add(refractionIntensity))
                        .mul(absorption)
                );
                const refractUvB = viewportUV.sub(
                    refractNormal
                        .mul(slide.mul(4.0).add(refractionIntensity))
                        .mul(absorption)
                );

                const red = texture(sceneTex, refractUvR).r;
                const green = texture(sceneTex, refractUvG).g;
                const blue = texture(sceneTex, refractUvB).b;

                refractCol.assign(refractCol.add(vec3(red, green, blue)));
            }

            refractCol.assign(refractCol.div(float(LOOP)));

            const lightVector = vec3(
                lightPosition[0],
                lightPosition[1],
                lightPosition[2]
            );
            const viewVector = normalize(cameraPosition.sub(positionWorld));
            const normalVector = normalize(normalWorld);

            const halfVector = normalize(viewVector.add(lightVector));

            const NdotL = dot(normalVector, lightVector);
            const NdotH = dot(normalVector, halfVector);

            const kDiffuse = max(0.0, NdotL);

            const NdotH2 = NdotH.mul(NdotH);
            const kSpecular = pow(NdotH2, shininess);

            const fresnel = classicFresnel({
                viewVector: viewVector,
                worldNormal: normalVector,
                power: 5.0,
            });

            refractCol.assign(
                refractCol.add(kSpecular.add(kDiffuse).mul(0.01).add(fresnel))
            );

            return vec3(sat(refractCol));
        });

        return {
            utils: {
                refractAndDisperse,
            }
        };

    }, []);

    const backRenderTarget = new THREE.WebGLRenderTarget(
        window.innerWidth * window.devicePixelRatio,
        window.innerHeight * window.devicePixelRatio,
    );

    const mainRenderTarget = new THREE.WebGLRenderTarget(
        window.innerWidth * window.devicePixelRatio,
        window.innerHeight * window.devicePixelRatio,
    );

    useFrame((state) => {
        const { clock, gl, scene, camera } = state;

        uniforms.uTime.value = clock.getElapsedTime();

        if (!meshRef.current) return;

        meshRef.current.material.visible = false;
        gl.setRenderTarget(backRenderTarget);
        gl.render(scene, camera);

        meshRef.current.material.side = THREE.BackSide;
        meshRef.current.material.visible = true;

        uniforms.sceneTexture.value = backRenderTarget.texture;

        meshRef.current.material.colorNode = utils.refractAndDisperse({ sceneTex: uniforms.sceneTexture });

        gl.setRenderTarget(mainRenderTarget);
        gl.render(scene, camera);

        meshRef.current.material.side = THREE.FrontSide;
        uniforms.sceneTexture.value = mainRenderTarget.texture;

        meshRef.current.material.colorNode = utils.refractAndDisperse({ sceneTex: uniforms.sceneTexture });

        gl.setRenderTarget(null);
    });

    return (
        <>
            <mesh>
                <sphereGeometry args={[50, 16, 16]} />
                <meshBasicNodeMaterial
                    colorNode={backgroundNodes.sphereColorNode}
                    side={THREE.BackSide}
                />
            </mesh>
            <mesh ref={meshRef}>
                <icosahedronGeometry args={[1.5, 200]} />
                {/* <meshPhongNodeMaterial
                    color='white'
                    normalNode={nodes.normalNode}
                    positionNode={nodes.positionNode}
                    emissive={new THREE.Color('white').multiplyScalar(0.25)}
                    shininess={400.0}
                /> */}

                <meshStandardMaterial
                    color={new THREE.Color('white').multiplyScalar(1.2)}
                    normalNode={nodes.normalNode}
                    positionNode={nodes.positionNode}
                />
            </mesh>
        </>
    )
}

export default WaterDrop;