import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react'

interface LandingShaderSceneProps {
  readonly onFirstFrame?: () => void
}

export default function LandingShaderScene({
  onFirstFrame,
}: LandingShaderSceneProps) {
  return (
    <div className="landing-shader-canvas absolute inset-0 h-full w-full opacity-80">
      <ShaderGradientCanvas
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
        pixelDensity={1}
        fov={45}
        pointerEvents="none"
        lazyLoad={false}
        preserveDrawingBuffer={false}
      >
        <ShaderReadyProbe onFirstFrame={onFirstFrame} />
        <ShaderGradient
          animate="on"
          type="plane"
          shader="defaults"
          color1="#f8ae41"
          color2="#f5f2f0"
          color3="#d9c7aa"
          uSpeed={0.18}
          uStrength={4}
          uDensity={1.3}
          uFrequency={5.5}
          brightness={1.12}
          grain="on"
          lightType="3d"
          cDistance={3.6}
          cPolarAngle={90}
          cAzimuthAngle={180}
          positionX={-1.4}
          rotationY={10}
          rotationZ={50}
        />
      </ShaderGradientCanvas>
    </div>
  )
}

function ShaderReadyProbe({
  onFirstFrame,
}: {
  readonly onFirstFrame?: () => void
}) {
  const reported = useRef(false)

  useFrame(() => {
    if (reported.current || !onFirstFrame) return

    reported.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(onFirstFrame)
    })
  })

  return null
}
