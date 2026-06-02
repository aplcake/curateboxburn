import * as THREE from 'three'
import { PALETTE } from '../core/palettes'

export type MouthRingMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uTime: { value: number }
    uPulse: { value: number }
    uBase: { value: THREE.Color }
    uHot: { value: THREE.Color }
    uDark: { value: THREE.Color }
  }
}

export function createMouthRingMaterial(): MouthRingMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uBase: { value: new THREE.Color(PALETTE.warningYellow) },
      uHot: { value: new THREE.Color(PALETTE.bone) },
      uDark: { value: new THREE.Color(PALETTE.outline) },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv - 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uPulse;
      uniform vec3 uBase;
      uniform vec3 uHot;
      uniform vec3 uDark;
      varying vec2 vUv;

      void main() {
        float radius = length(vUv) * 2.0;
        if (radius > 1.0) discard;
        float ring = step(abs(fract(radius * 5.0 - uTime * (2.2 + uPulse * 2.0)) - 0.5), 0.18 + uPulse * 0.035);
        float center = smoothstep(0.52, 0.16, radius);
        vec3 color = mix(uBase, uHot, ring);
        color = mix(color, uDark, center);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }) as MouthRingMaterial
}
