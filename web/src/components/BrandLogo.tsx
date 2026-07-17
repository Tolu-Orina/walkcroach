import { Link } from 'react-router-dom';

type BrandLogoProps = {
  to?: string;
  showWordmark?: boolean;
  className?: string;
};

export function BrandLogo({
  to = '/',
  showWordmark = true,
  className = '',
}: BrandLogoProps) {
  const content = (
    <>
      <img
        src="/walkcroach-icon.png"
        alt=""
        className="h-8 w-8 shrink-0 rounded-sm"
        width={32}
        height={32}
      />
      {showWordmark && (
        <span className="font-display text-sm font-bold tracking-tight text-paper">
          WalkCroach
        </span>
      )}
    </>
  );

  const classes = `interactive inline-flex items-center gap-2.5 ${className}`;

  if (to) {
    return (
      <Link to={to} className={classes} aria-label="WalkCroach home">
        {content}
      </Link>
    );
  }

  return <span className={classes}>{content}</span>;
}
