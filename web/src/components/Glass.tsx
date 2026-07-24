import {
  createElement,
  forwardRef,
  type FormEventHandler,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';

type GlassBaseProps = {
  children?: ReactNode;
  strong?: boolean;
  hairline?: boolean;
  className?: string;
};

type GlassDivProps = GlassBaseProps &
  Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'> & {
    as?: 'div' | 'section' | 'article' | 'aside';
  };

type GlassFormProps = GlassBaseProps &
  Omit<HTMLAttributes<HTMLFormElement>, 'children' | 'className'> & {
    as: 'form';
    onSubmit?: FormEventHandler<HTMLFormElement>;
  };

export type GlassProps = GlassDivProps | GlassFormProps;

/**
 * Frosted glass surface — Graphite Lumen tokens.
 * Use over chromatic / photographic backgrounds only.
 */
export const Glass = forwardRef<HTMLDivElement | HTMLFormElement, GlassProps>(
  function Glass(props, ref) {
    const {
      children,
      className,
      strong = false,
      hairline = false,
      as = 'div',
      ...rest
    } = props;

    return createElement(
      as,
      {
        ref,
        className: clsx(
          strong ? 'glass-strong' : 'glass',
          hairline && 'glass-hairline',
          className,
        ),
        ...rest,
      },
      children,
    );
  },
);
