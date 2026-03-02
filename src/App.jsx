import { useState, useEffect, useRef } from "react";


// ---------------------------- CONSTANT VALUES ---------------------------- //

const STORAGE_KEY = "contraction-clock-session";
const TICK_MS = 100;
const Y_AXIS_W = 44;
const X_LABEL_H = 22;
const CHART_H = 220;
const PLOT_H = CHART_H - X_LABEL_H;
const PEAK_PAD = 16;
const PX_PER_SEC = 4;
const MIN_REST_PX = 32;

// --------------------------- HELPER FUNCTIONS ---------------------------- //

function gauss(x) {
  const sigma = 0.15;
  const raw = Math.exp(-((x - 0.5) ** 2) / (2 * sigma ** 2));
  const floor = Math.exp(-(0.5 ** 2) / (2 * sigma ** 2));
  return Math.max(0, (raw - floor) / (1 - floor));
}

function buildBellPath(x0, widthPx, intensity, progress = 1) {
  const steps = 80;
  const maxStep = Math.floor(steps * Math.min(progress, 1));
  const pts = [];
  for (let i = 0; i <= maxStep; i++) {
    const t = i / steps;
    const px = x0 + t * widthPx;
    const amp = gauss(t) * intensity;
    const py = PLOT_H - amp * (PLOT_H - PEAK_PAD);
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  if (pts.length < 2) return { stroke: "", fill: "" };
  const stroke = "M" + pts.join("L");
  const lastX = (x0 + Math.min(progress, 1) * widthPx).toFixed(1);
  const fill = stroke + ` L${lastX},${PLOT_H} L${x0.toFixed(1)},${PLOT_H} Z`;
  return { stroke, fill };
}

function secPx(ms) {
  return (ms / 1000) * PX_PER_SEC;
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}


// function for window resizing to help with mobile layout
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const fn = () => setWidth(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return width;
}


// ------------------------- STATE SETUP FOR APP --------------------------- //

export default function ContractionClock() {

  const [contractions, setContractions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  });
  const [activeStart, setActiveStart] = useState(null);
  const [liveScroll, setLiveScroll] = useState(true);
  const [intensity, setIntensity] = useState(5);
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contractions));
  }, [contractions]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !liveScroll) return;
    el.scrollLeft = el.scrollWidth;
  }, [contractions, now, liveScroll]);

  // Track the actual rendered width of the chart container
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    // Measure immediately after mount
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Re-measure whenever the window resizes (catches orientation changes on mobile)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width);
  }, [windowWidth]);

  const toggleContraction = () => {
    if (!activeStart) {
      setActiveStart(Date.now());
    } else {
      const duration = now - activeStart;
      if (duration < 1000) { setActiveStart(null); return; }
      setContractions(prev => [...prev, {
        id: activeStart, start: activeStart, end: now, duration,
        intensity: intensity / 10,
      }]);
      setActiveStart(null);
    }
  };

  const clearSession = () => {
    setContractions([]); setActiveStart(null);
    localStorage.removeItem(STORAGE_KEY);
  };


  // ------------------------ build chart segments  ------------------------ //
  const segments = [];
  const LEAD_PX = 24;
  let cursor = Y_AXIS_W + 8;

  segments.push({ type: "flat", x: cursor - LEAD_PX, widthPx: LEAD_PX });

  contractions.forEach((c, i) => {
    if (i > 0) {
      const restMs = c.start - contractions[i - 1].end;
      const restPx = Math.max(MIN_REST_PX, secPx(restMs));
      segments.push({ type: "flat", x: cursor, widthPx: restPx, label: formatDuration(restMs) });
      cursor += restPx;
    }
    const bellPx = Math.max(8, secPx(c.duration));
    segments.push({ type: "bell", x: cursor, widthPx: bellPx, c });
    cursor += bellPx;
  });

  if (activeStart) {
    const elapsedMs = now - activeStart;
    if (contractions.length > 0) {
      const restMs = activeStart - contractions[contractions.length - 1].end;
      const restPx = Math.max(MIN_REST_PX, secPx(restMs));
      segments.push({ type: "flat", x: cursor, widthPx: restPx });
      cursor += restPx;
    }
    const activePx = Math.max(8, secPx(elapsedMs));
    segments.push({ type: "bell", x: cursor, widthPx: activePx, active: true, progress: 1, intensity: intensity / 10 });
    cursor += activePx;
  }

  segments.push({ type: "flat", x: cursor, widthPx: LEAD_PX });
  cursor += LEAD_PX;

  const svgWidth = cursor;
  const isActive = !!activeStart;
  const activeDuration = isActive ? now - activeStart : 0;

  const last = contractions[contractions.length - 1];
  const secondLast = contractions[contractions.length - 2];
  const avgDuration = contractions.length
    ? contractions.reduce((s, c) => s + c.duration, 0) / contractions.length : null;
  const lastInterval = last && secondLast ? last.start - secondLast.start : null;

  const yTicks = [0, 2, 4, 6, 8, 10];

  // ------------------------------ 511 RULE ------------------------------- //

  // Contractions <= 5 min apart (start-to-start), lasting >= 1 min each, for >= 1 hour
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const ONE_MIN_MS  = 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;

  // Walk backwards from the most recent contraction to find the current qualifying streak:
  // the longest tail of contractions where EVERY contraction lasts >= 1 min AND every
  // consecutive interval is <= 5 min. The streak start time is the start of the earliest
  // qualifying contraction in that unbroken run.
  let qualifyingStreakStart = null; // start time of the earliest contraction in the current streak

  if (contractions.length >= 1) {
    // Start from the last contraction and walk backwards as long as criteria hold
    let streakBegin = contractions.length - 1; // index of earliest contraction still in streak

    // The last contraction must itself last >= 1 min to be in the streak
    if (contractions[streakBegin].duration >= ONE_MIN_MS) {
      // Walk backwards: each prior contraction must also last >= 1 min
      // and the interval to the next must be <= 5 min
      for (let i = contractions.length - 2; i >= 0; i--) {
        const interval = contractions[i + 1].start - contractions[i].start;
        const dur = contractions[i].duration;
        if (dur >= ONE_MIN_MS && interval <= FIVE_MIN_MS) {
          streakBegin = i;
        } else {
          break; // streak broken
        }
      }
      qualifyingStreakStart = contractions[streakBegin].start;
    }
  }

  // How long has the current qualifying streak been running?
  // Use `now` so the timer ticks live while a contraction is active.
  const streakDuration = qualifyingStreakStart !== null ? now - qualifyingStreakStart : 0;
  const rule511Met = streakDuration >= ONE_HOUR_MS;

  // Frequency and Duration tiles use ALL session contractions
  const allIntervals = contractions.length >= 2
    ? contractions.slice(1).map((c, i) => c.start - contractions[i].start)
    : [];
  const avgRecentInterval = allIntervals.length
    ? allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length : null;

  const avgRecentDuration = contractions.length
    ? contractions.reduce((a, b) => a + b.duration, 0) / contractions.length : null;

  // Ongoing tile still uses the strict qualifying streak
  const streakContractions = qualifyingStreakStart !== null
    ? contractions.filter(c => c.start >= qualifyingStreakStart)
    : [];

  // In live mode, pan data left so the rightmost content aligns to the container's right edge.
  // Use containerWidth from ResizeObserver (accurate to actual rendered element width).
  // If not yet measured (0), use svgWidth so panX=0 and nothing is hidden before first measurement.
  const effectiveContainerWidth = containerWidth > 0 ? containerWidth : svgWidth;
  const panX = liveScroll
    ? Math.max(-(svgWidth - Y_AXIS_W), Math.min(0, effectiveContainerWidth - svgWidth))
    : 0;

  // Button size scales with screen
  const btnSize = isMobile ? 140 : 180;

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at 20% 30%, #0d1b2a 0%, #060d14 60%, #0a1520 100%)",
      fontFamily: "'Georgia', serif",
      color: "#e8dcc8",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: isMobile ? "24px 12px 40px" : "40px 24px 48px",
      gap: isMobile ? 20 : 28,
      boxSizing: "border-box",
    }}>

      {/* ── Header ── */}
      <div style={{ textAlign: "center" }}>
        {/* <div style={{ fontSize: isMobile ? 10 : 11, letterSpacing: "0.3em", color: "#7a9ab0", textTransform: "uppercase", marginBottom: 6 }}>
          Labor Companion
        </div> */}
        <h1 style={{ margin: 0, fontSize: isMobile ? 30 : 40, fontWeight: 400, color: "#f0e6d3", letterSpacing: "0.05em" }}>
          Contraction Clock
        </h1>
      </div>

      {/* ── 5-1-1 Rule Display ── */}
      {
        <div style={{
          width: "100%", maxWidth: 860,
          borderRadius: 12,
          border: `1px solid ${rule511Met ? "rgba(220,100,80,0.4)" : "rgba(255,255,255,0.07)"}`,
          background: rule511Met
            ? "rgba(180,60,40,0.12)"
            : "rgba(255,255,255,0.03)",
          padding: isMobile ? "14px 16px" : "16px 24px",
          transition: "all 0.4s ease",
        }}>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.25em", color: "#5a7a8a", textTransform: "uppercase", marginBottom: 4 }}>
                5-1-1 Rule
              </div>
              <div style={{ fontSize: isMobile ? 11 : 12, color: "#6a8a9a", maxWidth: 340 }}>
                Contractions ≤5 min apart, lasting ≥1 min, for ≥1 hour
              </div>
            </div>
            {/* Is it time? badge */}
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              flexShrink: 0, marginLeft: 16,
            }}>
              <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#5a7a8a", textTransform: "uppercase" }}>
                Is it time?
              </div>
              <div style={{
                fontSize: isMobile ? 18 : 22, fontWeight: 600,
                color: rule511Met ? "#e87060" : "#3a6a5a",
                letterSpacing: "0.05em",
                textShadow: rule511Met ? "0 0 20px rgba(220,80,60,0.5)" : "none",
                transition: "all 0.4s ease",
              }}>
                {rule511Met ? "YES" : "NOT YET"}
              </div>
            </div>
          </div>

          {/* Three progress indicators */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: isMobile ? 8 : 16 }}>
            {[
              {
                label: "Frequency",
                target: "≤ 5 min",
                value: avgRecentInterval,
                met: avgRecentInterval !== null && avgRecentInterval <= FIVE_MIN_MS,
                display: avgRecentInterval ? formatDuration(avgRecentInterval) : "—",
              },
              {
                label: "Duration",
                target: "≥ 1 min",
                value: avgRecentDuration,
                met: avgRecentDuration !== null && avgRecentDuration >= ONE_MIN_MS,
                display: avgRecentDuration ? formatDuration(avgRecentDuration) : "—",
              },
              {
                label: "Ongoing",
                target: "≥ 1 hour",
                value: streakDuration,
                met: streakDuration >= ONE_HOUR_MS,
                display: qualifyingStreakStart !== null ? formatDuration(streakDuration) : "—",
              },
            ].map(({ label, target, met, display }) => (
              <div key={label} style={{
                borderRadius: 8,
                background: met ? "rgba(80,160,100,0.1)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${met ? "rgba(80,160,100,0.3)" : "rgba(255,255,255,0.06)"}`,
                padding: isMobile ? "8px 10px" : "10px 14px",
                transition: "all 0.3s ease",
              }}>
                <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#5a7a8a", textTransform: "uppercase", marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ fontSize: isMobile ? 15 : 18, color: met ? "#80c890" : "#e8c9a0", marginBottom: 2 }}>
                  {display}
                </div>
                <div style={{ fontSize: 9, color: met ? "#50a870" : "#3a5a6a" }}>
                  {met ? "✓ " : ""}{target}
                </div>
              </div>
            ))}
          </div>
        </div>
      }

      {/* ── Controls: desktop = row, mobile = column ── */}
      <div style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: "center",
        gap: isMobile ? 16 : 40,
        width: "100%",
        maxWidth: 700,
        justifyContent: "center",
      }}>
        {/* Big button */}
        <button onClick={toggleContraction} style={{
          width: btnSize, height: btnSize, borderRadius: "50%",
          flexShrink: 0,
          border: isActive ? "3px solid #e8a87c" : "2px solid #2a4a63",
          background: isActive
            ? "radial-gradient(circle, #a0522d 0%, #7a3520 60%, #4a1f10 100%)"
            : "radial-gradient(circle, #1a3a55 0%, #0d2035 60%, #060d18 100%)",
          color: isActive ? "#fdf0e0" : "#7ab0c8",
          fontSize: isMobile ? 13 : 14,
          letterSpacing: "0.08em", cursor: "pointer",
          transition: "all 0.2s ease",
          boxShadow: isActive
            ? "0 0 40px rgba(200,100,50,0.4), inset 0 0 20px rgba(0,0,0,0.5)"
            : "0 0 20px rgba(0,60,100,0.3), inset 0 0 10px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
          userSelect: "none", touchAction: "manipulation",
        }}>
          <span style={{ fontSize: isMobile ? 24 : 28 }}>{isActive ? "●" : "○"}</span>
          <span>{isActive ? "Tap to Stop" : "Tap to Start"}</span>
          {isActive && (
            <span style={{ fontSize: isMobile ? 17 : 20, fontWeight: 600, color: "#ffd4a8", fontFamily: "monospace" }}>
              {formatDuration(activeDuration)}
            </span>
          )}
        </button>

        {/* Intensity + stats sidebar on desktop, stacked on mobile */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          alignItems: isMobile ? "center" : "flex-start",
          width: isMobile ? "100%" : "auto",
        }}>
          {/* Intensity slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, width: isMobile ? "min(280px, 90vw)" : 240 }}>
            <span style={{ fontSize: 10, color: "#7a9ab0", letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              Intensity
            </span>
            <input type="range" min={1} max={10} value={intensity}
              onChange={e => setIntensity(+e.target.value)}
              style={{ flex: 1, accentColor: "#e8a87c", height: 4 }} />
            <span style={{ fontSize: 14, color: "#e8a87c", width: 20, textAlign: "right" }}>{intensity}</span>
          </div>

          {/* Stats — inline on desktop sidebar, 2x2 grid on mobile */}
          {contractions.length > 0 && (
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr",
              gap: isMobile ? "12px 24px" : "12px 32px",
              width: isMobile ? "min(280px, 90vw)" : "auto",
            }}>
              {[
                ["Count", contractions.length],
                ["Avg Duration", avgDuration ? formatDuration(avgDuration) : "–"],
                ["Last Interval", lastInterval ? formatDuration(lastInterval) : "–"],
                ["Last Duration", last ? formatDuration(last.duration) : "–"],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#5a7a8a", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: isMobile ? 17 : 20, color: "#e8c9a0" }}>{val}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Chart ── */}
      <div style={{ width: "100%", maxWidth: 860, position: "relative" }}>

        {/* Live toggle */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button
            onClick={() => {
              const next = !liveScroll;
              setLiveScroll(next);
              if (next && scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
            }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: liveScroll ? "rgba(90,176,208,0.12)" : "rgba(255,255,255,0.04)",
              border: liveScroll ? "1px solid #3a7a9a" : "1px solid #2a3a4a",
              borderRadius: 6, padding: "5px 12px",
              color: liveScroll ? "#5ab0d0" : "#4a6a7a",
              fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase",
              cursor: "pointer", transition: "all 0.2s ease",
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: liveScroll ? "#5ab0d0" : "#3a5a6a",
              boxShadow: liveScroll ? "0 0 6px #5ab0d0" : "none",
              transition: "all 0.2s ease", display: "inline-block",
            }} />
            {liveScroll ? "Current" : "Scroll Timeline"}
          </button>
        </div>

        {/* Rotated Y-axis label */}
        <div style={{
          position: "absolute", left: -2, top: 30, height: PLOT_H,
          width: 18, display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none", zIndex: 1,
        }}>
          <span style={{
            fontSize: 9, letterSpacing: "0.15em", color: "#5a7a8a",
            textTransform: "uppercase", transform: "rotate(-90deg)", whiteSpace: "nowrap",
          }}>Intensity</span>
        </div>

        <div ref={scrollRef} style={{
          overflowX: liveScroll ? "hidden" : "auto",
          background: "rgba(255,255,255,0.03)", borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.07)",
          paddingTop: 12,
          paddingBottom: liveScroll ? 0 : 8,
          WebkitOverflowScrolling: "touch",
          // In live mode, shift the SVG so the right edge (latest content) is always visible
          position: "relative",
        }}>
          <svg
            width={liveScroll ? "100%" : svgWidth}
            height={CHART_H}
            style={{ display: "block" }}
          >
            {/* ── Layer 1: data (pans left in live mode) ── */}
            <g transform={`translate(${panX}, 0)`}>

            {/* Grid lines */}
            {yTicks.map(tick => {
              const norm = tick / 10;
              const y = PLOT_H - norm * (PLOT_H - PEAK_PAD);
              return (
                <line key={tick} x1={Y_AXIS_W} y1={y} x2={svgWidth - 8} y2={y}
                  stroke={tick === 0 ? "#2a5a7a" : "#0e2535"}
                  strokeWidth={tick === 0 ? 1.5 : 1}
                  strokeDasharray={tick === 0 ? undefined : "3,7"} />
              );
            })}

            {/* Segments */}
            {segments.map((seg, i) => {
              if (seg.type === "flat") {
                return (
                  <g key={i}>
                    <line x1={seg.x} y1={PLOT_H} x2={seg.x + seg.widthPx} y2={PLOT_H}
                      stroke="#2a5a7a" strokeWidth={1.5} />
                    {seg.label && (
                      <text x={seg.x + seg.widthPx / 2} y={PLOT_H + 14}
                        textAnchor="middle" fontSize={8} fill="#3a6a7a" fontFamily="monospace">
                        {seg.label}
                      </text>
                    )}
                  </g>
                );
              }

              if (seg.type === "bell") {
                const inten = seg.active ? seg.intensity : seg.c.intensity;
                const { stroke, fill } = buildBellPath(seg.x, seg.widthPx, inten, seg.progress ?? 1);
                const color = seg.active ? "#e8a87c" : "#5ab0d0";
                const fillColor = seg.active ? "rgba(200,100,50,0.13)" : "rgba(90,176,208,0.1)";
                return (
                  <g key={i}>
                    <line x1={seg.x} y1={PLOT_H} x2={seg.x} y2={PLOT_H - 8}
                      stroke={color} strokeWidth={1} strokeOpacity={0.5} />
                    {!seg.active && (
                      <line x1={seg.x + seg.widthPx} y1={PLOT_H}
                        x2={seg.x + seg.widthPx} y2={PLOT_H - 8}
                        stroke={color} strokeWidth={1} strokeOpacity={0.5} />
                    )}
                    <path d={fill} fill={fillColor} />
                    <path d={stroke} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
                    {!seg.active && (
                      <text x={seg.x + seg.widthPx / 2} y={PLOT_H + 14}
                        textAnchor="middle" fontSize={8} fill="#4a8a9a" fontFamily="monospace">
                        {formatDuration(seg.c.duration)}
                      </text>
                    )}
                  </g>
                );
              }
              return null;
            })}

            </g>{/* end data layer */}

            {/* Empty state text in screen coords (not panned) */}
            {contractions.length === 0 && !activeStart && (
              <text
                x={Y_AXIS_W + (effectiveContainerWidth - Y_AXIS_W) / 2}
                y={PLOT_H / 2}
                textAnchor="middle" fontSize={11} fill="#2a4a5a" fontFamily="Georgia, serif">
                Tap the button when a contraction begins
              </text>
            )}

            {/* ── Layer 2: Y-axis overlay (always on top, never pans) ── */}
            <rect x={0} y={0} width={Y_AXIS_W} height={CHART_H} fill="#0d1b22" fillOpacity={0.97} />
            <line x1={Y_AXIS_W} y1={PEAK_PAD - 4} x2={Y_AXIS_W} y2={PLOT_H}
              stroke="#2a4a5a" strokeWidth={1} />
            {yTicks.map(tick => {
              const norm = tick / 10;
              const y = PLOT_H - norm * (PLOT_H - PEAK_PAD);
              return (
                <g key={tick}>
                  <line x1={Y_AXIS_W - 4} y1={y} x2={Y_AXIS_W} y2={y}
                    stroke="#2a5a7a" strokeWidth={1} />
                  <text x={Y_AXIS_W - 7} y={y + 4} textAnchor="end"
                    fontSize={9} fill="#4a7a8a" fontFamily="monospace">
                    {tick}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* ── Session Log ── */}
      {contractions.length > 0 && (
        <div style={{ width: "100%", maxWidth: 860 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.2em", color: "#5a7a8a", textTransform: "uppercase", marginBottom: 12 }}>
            Contraction Log
          </div>

          {/* Column definitions — 5 cols desktop, 4 cols mobile (drop intensity bar) */}
          {(() => {
            const cols = isMobile ? "32px 1fr 60px 60px" : "36px 1fr 80px 80px 90px";
            const headerStyle = {
              fontSize: 9, letterSpacing: "0.18em", color: "#3a6a7a",
              textTransform: "uppercase", padding: isMobile ? "0 6px" : "0 8px",
            };
            return (
              <>
                {/* Header row */}
                <div style={{
                  display: "grid", gridTemplateColumns: cols,
                  gap: isMobile ? 6 : 12,
                  padding: isMobile ? "0 12px 6px" : "0 16px 8px",
                  borderBottom: "1px solid rgba(255,255,255,0.07)",
                  marginBottom: 6,
                }}>
                  <span style={headerStyle}>#</span>
                  <span style={headerStyle}>Start Time</span>
                  <span style={{ ...headerStyle, textAlign: "right" }}>Duration</span>
                  <span style={{ ...headerStyle, textAlign: "right" }}>Frequency</span>
                  {!isMobile && <span style={{ ...headerStyle, textAlign: "right" }}>Intensity</span>}
                </div>

                {/* Data rows — chronological order (oldest first, newest last) */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {[...contractions].reverse().map((c, i) => {
                    const originalIndex = contractions.length - 1 - i;
                    const frequency = originalIndex === 0 ? null : c.start - contractions[originalIndex - 1].start;
                    const isLatest = i === 0;
                    return (
                      <div key={c.id} style={{
                        display: "grid", gridTemplateColumns: cols,
                        alignItems: "center", gap: isMobile ? 6 : 12,
                        padding: isMobile ? "7px 12px" : "8px 16px",
                        borderRadius: 7,
                        background: isLatest ? "rgba(90,160,200,0.08)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isLatest ? "rgba(90,160,200,0.15)" : "rgba(255,255,255,0.04)"}`,
                        fontSize: isMobile ? 11 : 13,
                        transition: "background 0.2s",
                      }}>
                        <span style={{ color: "#5ab0d0", fontVariantNumeric: "tabular-nums" }}>
                          #{originalIndex + 1}
                        </span>
                        <span style={{ color: "#8aacbc", fontVariantNumeric: "tabular-nums" }}>
                          {formatTime(c.start)}
                        </span>
                        <span style={{ color: "#e8c9a0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {formatDuration(c.duration)}
                        </span>
                        <span style={{ color: frequency ? "#a8c8a0" : "#3a5a4a", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {frequency ? formatDuration(frequency) : "—"}
                        </span>
                        {!isMobile && (
                          <span style={{ color: "#a07850", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {Math.round(c.intensity * 10)} / 10
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}

          <button onClick={clearSession} style={{
            marginTop: 16, background: "none", border: "1px solid #2a3a4a",
            color: "#4a6a7a", fontSize: 11, letterSpacing: "0.15em", padding: "8px 20px",
            borderRadius: 6, cursor: "pointer", textTransform: "uppercase",
          }}>
            Clear Session
          </button>
        </div>
      )}
    </div>
  );
}