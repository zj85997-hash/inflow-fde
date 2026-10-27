/** InFlow 标志：一条流过方块的线 —— 工作流交给 Agent 跑起来 */
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#10b981" />
      <path d="M6 19c3.2-5.4 6.4-5.4 9.6 0s6.4 5.4 9.6 0" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="25.2" cy="12" r="2.2" fill="#fff" />
    </svg>
  );
}
