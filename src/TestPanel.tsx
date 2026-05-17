import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import {
  appState,
  DEFAULT_POSE_TEST_MODEL_URL,
  setPoseTestCameraId,
  setPoseTestEnabled,
  setPoseTestFollowPosition,
  setPoseTestMinVisibility,
  setPoseTestMirror,
  setPoseTestModelUrl,
  setPoseTestPositionScale,
  setPoseTestRigStrength,
  setPoseTestStatus,
  setPoseTestWorldLandmarks,
} from './appState'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'

type CameraDevice = {
  deviceId: string
  label: string
}

const panelBg: CSSProperties = {
  background: 'rgba(14, 14, 18, 0.58)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
  borderRadius: 8,
}

const labelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'rgba(255,255,255,0.38)',
  fontFamily: "'Courier New', monospace",
}

export default function TestPanel() {
  const {
    poseTestEnabled,
    poseTestStatus,
    poseTestModelUrl,
    poseTestCameraId,
    poseTestMirror,
    poseTestRigStrength,
    poseTestMinVisibility,
    poseTestFollowPosition,
    poseTestPositionScale,
    poseTestFrameTime,
  } = useSnapshot(appState)
  const videoRef = useRef<HTMLVideoElement>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    refreshDevices()
    return () => stopCapture()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Capture teardown is intentionally one-shot.
  }, [])

  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setPoseTestStatus('No media device API')
      return
    }
    const found = await navigator.mediaDevices.enumerateDevices()
    setDevices(
      found
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
        })),
    )
  }

  const stopCapture = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    lastVideoTimeRef.current = -1
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    landmarkerRef.current?.close()
    landmarkerRef.current = null
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }
    setPoseTestWorldLandmarks(null)
    setPoseTestEnabled(false)
    setPoseTestStatus('Stopped')
  }

  const startCapture = async () => {
    if (loading) return
    setLoading(true)
    setPoseTestStatus('Loading MediaPipe')

    try {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
      const wasmRoot = `${window.location.origin}${import.meta.env.BASE_URL}mediapipe/wasm`
      const vision = await FilesetResolver.forVisionTasks(wasmRoot)
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: poseTestModelUrl || DEFAULT_POSE_TEST_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
        outputSegmentationMasks: false,
      })
      landmarkerRef.current = landmarker

      setPoseTestStatus('Opening camera')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: poseTestCameraId ? { exact: poseTestCameraId } : undefined,
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 30, max: 60 },
        },
      })
      streamRef.current = stream
      await refreshDevices()

      const video = videoRef.current
      if (!video) throw new Error('Hidden video element is missing')
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play()

      setPoseTestEnabled(true)
      setPoseTestStatus('Tracking')
      rafRef.current = requestAnimationFrame(trackFrame)
    } catch (error) {
      stopCapture()
      setPoseTestStatus(error instanceof Error ? error.message : 'Failed to start')
    } finally {
      setLoading(false)
    }
  }

  const trackFrame = () => {
    const video = videoRef.current
    const landmarker = landmarkerRef.current
    if (!video || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      rafRef.current = requestAnimationFrame(trackFrame)
      return
    }

    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime
      const result = landmarker.detectForVideo(video, performance.now())
      setPoseTestWorldLandmarks(result.worldLandmarks[0] ?? null)
      if (!result.worldLandmarks[0]) setPoseTestStatus('No pose')
      else setPoseTestStatus('Tracking')
    }

    rafRef.current = requestAnimationFrame(trackFrame)
  }

  const ageMs = poseTestFrameTime ? Math.max(0, performance.now() - poseTestFrameTime) : null

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      <video
        ref={videoRef}
        aria-hidden="true"
        style={{
          display: 'none',
          visibility: 'hidden',
          width: 0,
          height: 0,
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'fixed',
          left: 16,
          top: 62,
          width: 340,
          padding: 12,
          pointerEvents: 'auto',
          userSelect: 'none',
          ...panelBg,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ ...labelStyle, color: poseTestEnabled ? 'rgba(125,211,252,0.9)' : 'rgba(255,255,255,0.45)' }}>
              TEST CAPTURE
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.58)', marginTop: 4 }}>
              {poseTestStatus}{ageMs !== null && poseTestEnabled ? ` · ${Math.round(ageMs)} ms` : ''}
            </div>
          </div>
          <button
            onClick={poseTestEnabled ? stopCapture : startCapture}
            disabled={loading}
            style={{
              ...smallButtonStyle,
              color: poseTestEnabled ? 'rgba(251,113,133,0.95)' : 'rgba(125,211,252,0.96)',
              borderColor: poseTestEnabled ? 'rgba(251,113,133,0.28)' : 'rgba(125,211,252,0.26)',
            }}
          >
            {poseTestEnabled ? 'STOP' : loading ? 'LOADING' : 'START'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Camera">
            <select
              value={poseTestCameraId}
              onChange={(event) => setPoseTestCameraId(event.target.value)}
              style={inputStyle}
            >
              <option value="">Default camera</option>
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Pose Model URL">
            <input
              value={poseTestModelUrl}
              onChange={(event) => setPoseTestModelUrl(event.target.value)}
              placeholder={DEFAULT_POSE_TEST_MODEL_URL}
              style={inputStyle}
            />
          </Field>

          <ToggleRow label="Mirror camera motion" value={poseTestMirror} onChange={setPoseTestMirror} />
          <ToggleRow label="Follow room position" value={poseTestFollowPosition} onChange={setPoseTestFollowPosition} />

          <SliderRow label="Rig Strength" value={poseTestRigStrength} min={0.05} max={1} step={0.01} onChange={setPoseTestRigStrength} />
          <SliderRow label="Min Visibility" value={poseTestMinVisibility} min={0} max={0.9} step={0.01} onChange={setPoseTestMinVisibility} />
          <SliderRow label="Room Scale" value={poseTestPositionScale} min={0.2} max={3} step={0.05} onChange={setPoseTestPositionScale} />
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={labelStyle}>{label.toUpperCase()}</span>
      {children}
    </label>
  )
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: 5,
        padding: '8px 9px',
        cursor: 'pointer',
        background: value ? 'rgba(125,211,252,0.1)' : 'rgba(255,255,255,0.035)',
        border: value ? '1px solid rgba(125,211,252,0.26)' : '1px solid rgba(255,255,255,0.07)',
        color: value ? 'rgba(125,211,252,0.96)' : 'rgba(255,255,255,0.54)',
      }}
    >
      <span style={{ ...labelStyle, color: 'inherit' }}>{label.toUpperCase()}</span>
      <span style={{ fontSize: 10, fontFamily: 'monospace' }}>{value ? 'ON' : 'OFF'}</span>
    </button>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 42px', gap: 8, alignItems: 'center', marginBottom: 5 }}>
        <span style={labelStyle}>{label.toUpperCase()}</span>
        <span style={{ fontSize: 9, color: 'rgba(125,211,252,0.82)', fontFamily: 'monospace', textAlign: 'right' }}>
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="range-slider"
        aria-label={label}
        style={{ width: '100%' }}
      />
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: 5,
  padding: '7px 8px',
  fontSize: 10,
  color: 'rgba(255,255,255,0.78)',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  outline: 'none',
}

const smallButtonStyle: CSSProperties = {
  borderRadius: 4,
  padding: '7px 9px',
  fontSize: 8,
  fontWeight: 700,
  fontFamily: "'Courier New', monospace",
  letterSpacing: '0.08em',
  cursor: 'pointer',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
}
