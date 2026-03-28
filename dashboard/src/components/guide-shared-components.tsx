/**
 * Shared UI components for guide/SOP pages.
 * CopyBlock: code snippet with copy-to-clipboard.
 * CollapsibleItem: expandable FAQ/troubleshoot item.
 */
import { useState } from 'react';

export function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4 text-sm font-mono text-[#8892B0] overflow-x-auto">
        {code}
      </pre>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          } catch {
            // clipboard API unavailable (HTTP context or permission denied)
          }
          setTimeout(() => setCopied(false), 2000);
        }}
        className="absolute top-2 right-2 px-2 py-1 text-xs bg-[#2D3142] text-[#8892B0] rounded hover:text-white transition opacity-0 group-hover:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export function CollapsibleItem({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#2D3142] rounded-lg overflow-hidden">
      <button
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-mono text-[#8892B0] hover:text-white hover:bg-[#1A1A2E] transition-colors"
      >
        <span>{title}</span>
        <svg
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 pt-1 text-sm font-mono text-[#8892B0] space-y-2">{children}</div>}
    </div>
  );
}

type BannerColor = 'cyan' | 'yellow' | 'red' | 'green';

export function InfoBanner({ color, label, children }: { color: BannerColor; label: string; children: React.ReactNode }) {
  const colorMap: Record<string, { border: string; bg: string; text: string }> = {
    cyan: { border: 'border-[#00D9FF]/30', bg: 'bg-[#00D9FF]/5', text: 'text-[#00D9FF]' },
    yellow: { border: 'border-yellow-500/30', bg: 'bg-yellow-500/5', text: 'text-yellow-400' },
    red: { border: 'border-red-500/30', bg: 'bg-red-500/5', text: 'text-red-400' },
    green: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-400' },
  };
  const c = colorMap[color] ?? colorMap.cyan;
  return (
    <div className={`border ${c.border} ${c.bg} rounded-lg p-4`}>
      <p className={`text-sm font-mono ${c.text} font-bold mb-1`}>{label}</p>
      <div className="text-sm font-mono text-[#8892B0] leading-relaxed">{children}</div>
    </div>
  );
}
