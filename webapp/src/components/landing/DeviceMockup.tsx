import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Native screen size the app is designed at. Children render at this size, then scale. */
export const SCREEN_W = 390;
export const SCREEN_H = 844;

interface DeviceMockupProps {
  children: ReactNode;
  /** Accessible description of what the phone shows. */
  label: string;
  className?: string;
}

/**
 * A realistic phone frame. Width comes from the parent (className), height follows the
 * screen ratio. The screen content is rendered at 390×844 and scaled, so real app
 * screens can be dropped in unchanged.
 */
export function DeviceMockup({ children, label, className = '' }: DeviceMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bezel = Math.max(5, width * 0.032);
  const innerW = Math.max(0, width - bezel * 2);
  const scale = innerW / SCREEN_W;
  const innerH = SCREEN_H * scale;
  const outerRadius = width * 0.16;
  const innerRadius = outerRadius - bezel;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={`relative ${className}`}
      style={{ height: width ? innerH + bezel * 2 : undefined, aspectRatio: width ? undefined : '390 / 860' }}
    >
      {/* Body with a subtle metallic edge */}
      <div
        className="absolute inset-0 bg-[#0b0c0c] shadow-device"
        style={{
          borderRadius: outerRadius,
          boxShadow:
            'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 0 0 3px #1c1d1d, 0 50px 100px -20px rgba(10,10,10,0.35), 0 30px 60px -30px rgba(10,10,10,0.45)',
        }}
      />
      {/* Side buttons */}
      <span className="absolute -left-[2px] top-[18%] h-[5%] w-[3px] rounded-l bg-[#1f2020]" />
      <span className="absolute -left-[2px] top-[26%] h-[8%] w-[3px] rounded-l bg-[#1f2020]" />
      <span className="absolute -right-[2px] top-[24%] h-[11%] w-[3px] rounded-r bg-[#1f2020]" />

      {width > 0 && (
        <div
          aria-hidden="true"
          className="absolute overflow-hidden bg-night"
          style={{ left: bezel, top: bezel, width: innerW, height: innerH, borderRadius: innerRadius }}
        >
          <div style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            {children}
          </div>
          {/* Dynamic island */}
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black"
            style={{ top: 11 * scale, width: 122 * scale, height: 36 * scale }}
          />
        </div>
      )}
    </div>
  );
}
