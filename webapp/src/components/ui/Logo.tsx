interface LogoProps {
  className?: string;
  /** Show only the mark, without the wordmark. */
  markOnly?: boolean;
}

export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M6.5 25V7.5L16 17l9.5-9.5V25"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="16" cy="25" r="3" className="fill-accent-500" />
    </svg>
  );
}

export function Logo({ className = '', markOnly = false }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      {!markOnly && (
        <span className="text-[1.375rem] font-normal tracking-[-0.035em]">
          Mosa<span className="opacity-60">Vali</span>
        </span>
      )}
    </span>
  );
}
