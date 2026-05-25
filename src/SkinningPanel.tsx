import { useRef } from "react";
import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import { SliderComfortable } from "@/components/ui/slider";
import { Elevated } from "@/lib/elevated";
import {
  appState,
  setFlipNormalY,
  setOiliness,
  setPoreNormalStrength,
  setPoreScale,
  setSkinTextures,
  setSubsurfaceStrength,
  setSurfaceRoughness,
  setToneDepth,
  setWrinkleNormalStrength,
} from "./appState";
import {
  DEFAULT_FLIP_NORMAL_Y,
  DEFAULT_OILINESS,
  DEFAULT_PORE_NORMAL_STRENGTH,
  DEFAULT_PORE_SCALE,
  DEFAULT_SUBSURFACE_STRENGTH,
  DEFAULT_SURFACE_ROUGHNESS,
  DEFAULT_TONE_DEPTH,
  DEFAULT_WRINKLE_NORMAL_STRENGTH,
  SKIN_TEXTURE_LABELS,
  SKIN_TEXTURE_SLOTS,
  type SkinTextureSlot,
} from "./skinMaterial";

const labelStyle = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.12em",
  color: "rgba(255,255,255,0.36)",
  fontFamily: "'Courier New', monospace",
} as const;

export default function SkinningPanel() {
  const {
    skinTextures: textures,
    poreScale,
    poreNormalStrength,
    wrinkleNormalStrength,
    flipNormalY,
    oiliness,
    surfaceRoughness,
    toneDepth,
    subsurfaceStrength,
  } = useSnapshot(appState);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleUpload = (slot: SkinTextureSlot, file: File) => {
    const prev = textures[slot];
    if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
    setSkinTextures({ ...textures, [slot]: URL.createObjectURL(file) });
  };

  const handleReset = (slot: SkinTextureSlot) => {
    const prev = textures[slot];
    if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
    const next = { ...textures };
    delete next[slot];
    setSkinTextures(next);
  };

  const resetAll = () => {
    for (const slot of SKIN_TEXTURE_SLOTS) {
      const prev = textures[slot];
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
    }
    setPoreScale(DEFAULT_PORE_SCALE);
    setPoreNormalStrength(DEFAULT_PORE_NORMAL_STRENGTH);
    setWrinkleNormalStrength(DEFAULT_WRINKLE_NORMAL_STRENGTH);
    setFlipNormalY(DEFAULT_FLIP_NORMAL_Y);
    setOiliness(DEFAULT_OILINESS);
    setSurfaceRoughness(DEFAULT_SURFACE_ROUGHNESS);
    setToneDepth(DEFAULT_TONE_DEPTH);
    setSubsurfaceStrength(DEFAULT_SUBSURFACE_STRENGTH);
    setSkinTextures({});
  };

  const customCount =
    SKIN_TEXTURE_SLOTS.filter((s) => textures[s] !== undefined).length +
    (poreScale !== DEFAULT_PORE_SCALE ? 1 : 0) +
    (poreNormalStrength !== DEFAULT_PORE_NORMAL_STRENGTH ? 1 : 0) +
    (wrinkleNormalStrength !== DEFAULT_WRINKLE_NORMAL_STRENGTH ? 1 : 0) +
    (flipNormalY !== DEFAULT_FLIP_NORMAL_Y ? 1 : 0) +
    (oiliness !== DEFAULT_OILINESS ? 1 : 0) +
    (surfaceRoughness !== DEFAULT_SURFACE_ROUGHNESS ? 1 : 0) +
    (toneDepth !== DEFAULT_TONE_DEPTH ? 1 : 0) +
    (subsurfaceStrength !== DEFAULT_SUBSURFACE_STRENGTH ? 1 : 0);

  const sliderRow = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    defaultValue: number,
    onChange: (value: number) => void,
  ) => (
    <div className="px-3 py-2 border-b border-border/30">
      <SliderComfortable
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        formatValue={(v) => {
          const decimals = step >= 1 ? 0 : step >= 0.01 ? 2 : 3;
          return v.toFixed(decimals);
        }}
      />
      {value !== defaultValue && (
        <div className="flex justify-end mt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            onClick={() => onChange(defaultValue)}
          >
            ↺ Reset
          </Button>
        </div>
      )}
    </div>
  );

  const sectionLabel = (text: string) => (
    <div className="px-3 py-2 text-[8px] font-bold tracking-[0.16em] text-foreground/20 font-mono border-b border-border/20">
      {text}
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden select-none">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 shrink-0">
        <span style={labelStyle}>SKIN TEXTURES</span>
        <div className="flex items-center gap-2">
          {customCount > 0 && (
            <span className="text-[9px] text-sky-300/68 font-mono">
              {customCount} CUSTOM
            </span>
          )}
          {customCount > 0 && (
            <Button variant="ghost" size="sm" onClick={resetAll}>
              Reset All
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {sectionLabel("APPEARANCE")}
        {sliderRow(
          "OILINESS",
          oiliness,
          0,
          1,
          0.01,
          DEFAULT_OILINESS,
          setOiliness,
        )}
        {sliderRow(
          "SURFACE ROUGHNESS",
          surfaceRoughness,
          0.1,
          1,
          0.01,
          DEFAULT_SURFACE_ROUGHNESS,
          setSurfaceRoughness,
        )}
        {sliderRow(
          "TONE DEPTH",
          toneDepth,
          0,
          1,
          0.01,
          DEFAULT_TONE_DEPTH,
          setToneDepth,
        )}
        {sliderRow(
          "SUBSURFACE",
          subsurfaceStrength,
          0,
          1,
          0.01,
          DEFAULT_SUBSURFACE_STRENGTH,
          setSubsurfaceStrength,
        )}

        {sectionLabel("DETAIL")}
        {sliderRow(
          "PORE SCALE",
          poreScale,
          4,
          90,
          1,
          DEFAULT_PORE_SCALE,
          setPoreScale,
        )}
        {sliderRow(
          "PORE NORMAL",
          poreNormalStrength,
          0,
          2,
          0.05,
          DEFAULT_PORE_NORMAL_STRENGTH,
          setPoreNormalStrength,
        )}
        {sliderRow(
          "WRINKLE NORMAL",
          wrinkleNormalStrength,
          0,
          2,
          0.05,
          DEFAULT_WRINKLE_NORMAL_STRENGTH,
          setWrinkleNormalStrength,
        )}

        <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
          <span style={{ ...labelStyle, color: "rgba(255,255,255,0.48)" }}>
            FLIP NORMAL Y
          </span>
          <input
            type="checkbox"
            checked={flipNormalY}
            onChange={(e) => setFlipNormalY(e.target.checked)}
            className="accent-sky-400"
          />
        </div>

        {sectionLabel("TEXTURES")}
        {SKIN_TEXTURE_SLOTS.map((slot) => {
          const isCustom = textures[slot] !== undefined;
          return (
            <div
              key={slot}
              className="flex items-center px-3 py-1.5 gap-2 border-b border-border/20"
            >
              <span
                className="flex-1 text-[10px] font-mono"
                style={{
                  color: isCustom
                    ? "rgba(125,211,252,0.9)"
                    : "rgba(255,255,255,0.55)",
                }}
              >
                {SKIN_TEXTURE_LABELS[slot]}
              </span>

              <span
                className="text-[8px] font-mono min-w-10.5 text-right"
                style={{
                  color: isCustom
                    ? "rgba(125,211,252,0.5)"
                    : "rgba(255,255,255,0.18)",
                }}
              >
                {isCustom ? "CUSTOM" : "DEFAULT"}
              </span>

              {isCustom && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => handleReset(slot)}
                  title="Reset to default"
                >
                  ↺
                </Button>
              )}

              <Button
                variant="secondary"
                size="sm"
                className="h-6 px-2 text-[9px] shrink-0"
                onClick={() => inputRefs.current[slot]?.click()}
              >
                UPLOAD
              </Button>

              <input
                ref={(el) => {
                  inputRefs.current[slot] = el;
                }}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(slot, file);
                  e.target.value = "";
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
