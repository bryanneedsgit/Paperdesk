import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ToolbarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
};

export function ToolbarButton({
  children,
  icon,
  className = '',
  ...buttonProps
}: ToolbarButtonProps) {
  return (
    <button className={`toolbar-button ${className}`.trim()} type="button" {...buttonProps}>
      <span className="toolbar-button-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}
