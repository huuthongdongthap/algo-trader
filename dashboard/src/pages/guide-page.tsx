/**
 * App guide page at /app/guide — inside LayoutShell sidebar.
 * Renders GuideContent directly; sidebar provided by LayoutShell.
 */
import { GuideContent } from '../components/guide-content';

export function GuidePage() {
  return (
    <div className="max-w-[800px] mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold font-mono text-white mb-2">Operator Guide</h1>
        <p className="text-sm font-mono text-[#8892B0]">
          CashClaw SOPs — everything you need to run the market-making bot profitably.
        </p>
      </div>
      <GuideContent />
    </div>
  );
}
