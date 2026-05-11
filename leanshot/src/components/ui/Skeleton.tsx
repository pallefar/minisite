import { cn } from '@/lib/helpers';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shape?: 'rect' | 'pill' | 'circle' | 'text';
}

export function Skeleton({ shape = 'rect', className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden bg-[var(--color-skeleton)]',
        shape === 'rect' && 'rounded-md',
        shape === 'pill' && 'rounded-pill',
        shape === 'circle' && 'rounded-full',
        shape === 'text' && 'rounded-sm h-3.5',
        className,
      )}
      style={{
        background:
          'linear-gradient(90deg, var(--color-skeleton) 0%, color-mix(in oklab, var(--color-skeleton) 60%, transparent) 50%, var(--color-skeleton) 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.6s linear infinite',
      }}
      {...rest}
    />
  );
}
