import { Reveal } from '../ui/Reveal';

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  body?: string;
  dark?: boolean;
  align?: 'center' | 'left';
}

export function SectionHeading({ eyebrow, title, body, dark = false, align = 'center' }: SectionHeadingProps) {
  const centered = align === 'center';
  return (
    <Reveal className={centered ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      {eyebrow && (
        <p
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-label ${
            dark ? 'bg-night-2 text-mute-night' : 'bg-canvas text-mute'
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
          {eyebrow}
        </p>
      )}
      <h2 className={`whitespace-pre-line text-balance text-display ${eyebrow ? 'mt-5' : ''} ${dark ? 'text-paper' : 'text-ink'}`}>
        {title}
      </h2>
      {body && (
        <p
          className={`mt-5 text-balance text-body md:text-body-lg ${centered ? 'mx-auto max-w-xl' : 'max-w-xl'} ${
            dark ? 'text-mute-night' : 'text-mute'
          }`}
        >
          {body}
        </p>
      )}
    </Reveal>
  );
}
