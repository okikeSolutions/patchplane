import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react'
interface LandingShaderSceneProps {
  readonly dark: boolean
}

export default function LandingShaderScene({ dark }: LandingShaderSceneProps) {
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
          brightness={dark ? 0.92 : 1.12}
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
