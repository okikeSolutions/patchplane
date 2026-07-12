import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'

interface LandingShaderSceneProps {
  readonly dark: boolean
  readonly onReady: (ready: boolean) => void
}

export default function LandingShaderScene({
  dark,
  onReady,
}: LandingShaderSceneProps) {
  return (
    <ShaderGradientCanvas
      style={{ position: 'absolute', inset: 0 }}
      pixelDensity={1}
      fov={45}
      pointerEvents="none"
      lazyLoad={false}
      preserveDrawingBuffer={false}
      powerPreference="high-performance"
    >
      <ShaderGradient
        animate="on"
        type="plane"
        shader="defaults"
        color1="#f8ae41"
        color2={dark ? '#101421' : '#f5f2f0'}
        color3={dark ? '#263753' : '#d9c7aa'}
        uSpeed={0.18}
        uStrength={4}
        uDensity={1.3}
        uFrequency={5.5}
        uAmplitude={1}
        brightness={dark ? 0.92 : 1.12}
        grain="on"
        lightType="3d"
        cDistance={3.6}
        cPolarAngle={90}
        cAzimuthAngle={180}
        positionX={-1.4}
        positionY={0}
        positionZ={0}
        rotationX={0}
        rotationY={10}
        rotationZ={50}
      />
      <FirstFrameSignal onReady={onReady} />
    </ShaderGradientCanvas>
  )
}

interface FirstFrameSignalProps {
  readonly onReady: (ready: boolean) => void
}

function FirstFrameSignal({ onReady }: FirstFrameSignalProps) {
  const hasRendered = useRef(false)

  useFrame(() => {
    if (hasRendered.current) return

    hasRendered.current = true
    onReady(true)
  })

  return null
}
