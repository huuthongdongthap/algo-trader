/**
 * CSS-only typing terminal animation for landing page hero.
 * Cycles through MM log lines with staggered keyframe delays.
 */

const LINES = [
  '[MM] Selected: "Will Bitcoin hit $150K?" (score: 87)',
  '[MM] BID:0.42  ASK:0.52  (µ:0.471  inv:0)',
  '[FILL] BUY 30@0.42 CONFIRMED',
  '[Safety] Heartbeat active (5s)',
];

export function TerminalAnimation() {
  return (
    <div className="bg-[#0A0A14] border border-[#2D3142] rounded-lg p-4 font-mono text-xs overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-[#2D3142]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#FF3366]" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#00FF41]" />
        <span className="text-[#8892B0] ml-2">cashclaw — market-maker</span>
      </div>

      {/* Animated lines */}
      <div className="space-y-1.5">
        {LINES.map((line, i) => (
          <p
            key={i}
            className="terminal-line overflow-hidden whitespace-nowrap"
            style={{ animationDelay: `${i * 1.2}s` }}
          >
            <span className={
              line.startsWith('[FILL]') ? 'text-[#00FF41]' :
              line.startsWith('[Safety]') ? 'text-[#00D9FF]' :
              line.startsWith('[MM]') ? 'text-[#8892B0]' :
              'text-white'
            }>
              {line}
            </span>
            {i === LINES.length - 1 && (
              <span className="inline-block w-1.5 h-3.5 bg-[#00D9FF] ml-0.5 animate-pulse align-middle" />
            )}
          </p>
        ))}
      </div>

      <style>{`
        .terminal-line {
          max-width: 0;
          animation: type-in 0.8s steps(60, end) forwards;
          opacity: 0;
        }
        @keyframes type-in {
          from { max-width: 0; opacity: 1; }
          to   { max-width: 100%; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
