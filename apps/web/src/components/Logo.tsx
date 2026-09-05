export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#6B8E4E" />
      <g stroke="#F6F2EA" strokeWidth="5" strokeLinecap="round">
        <path d="M20 16 V48" />
        <path d="M44 16 V48" />
        <path d="M20 32 H44" />
      </g>
      <g fill="#F6F2EA">
        <circle cx="20" cy="16" r="4.4" />
        <circle cx="44" cy="16" r="4.4" />
        <circle cx="20" cy="48" r="4.4" />
        <circle cx="44" cy="48" r="4.4" />
        <circle cx="32" cy="32" r="4" />
      </g>
      <g stroke="#C77D4A" strokeWidth="2.6" strokeLinecap="round">
        <path d="M32 32 l7 -6" />
        <path d="M32 32 l-7 6" />
      </g>
      <g fill="#C77D4A">
        <circle cx="40" cy="25" r="2.4" />
        <circle cx="24" cy="39" r="2.4" />
      </g>
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark size={size} />
      <span className="text-lg font-bold tracking-tight text-substrate">
        Hyphae<span className="text-hyphae-600">Hub</span>
      </span>
    </div>
  );
}
