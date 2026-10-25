import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'inverse' | 'quiet';
type Size = 'md' | 'lg';

const base =
  'inline-flex min-h-tap items-center justify-center gap-2 rounded-full text-center font-normal leading-tight ' +
  'transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-accent-500 disabled:opacity-40 text-balance';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-night-3',
  secondary: 'border border-line bg-paper text-ink hover:bg-canvas',
  ghost: 'text-ink hover:bg-canvas',
  // On dark surfaces.
  accent: 'bg-accent-400 text-night hover:bg-accent-300',
  inverse: 'border border-line-night bg-night-2 text-paper hover:bg-night-3',
  quiet: 'text-paper/80 hover:bg-night-2 hover:text-paper',
};

const sizes: Record<Size, string> = {
  md: 'px-5 py-2.5 text-label',
  lg: 'px-7 py-3.5 text-body',
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant,
  size,
  className,
  children,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant, size, className, children }: CommonProps & { to: string }) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
