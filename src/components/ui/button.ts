export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md';

export const BUTTON_VARIANTS = ['btn', 'btn-secondary', 'btn-ghost', 'btn-danger', 'btn-link'] as const;
export const BUTTON_MODIFIERS = ['btn-sm', 'btn-icon', 'btn-block'] as const;

const VARIANT_CLASS: Record<ButtonVariant, (typeof BUTTON_VARIANTS)[number]> = {
  primary: 'btn',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  link: 'btn-link',
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  block?: boolean;
  class?: string;
}

export function buttonClass({ variant = 'primary', size = 'md', icon = false, block = false, class: extra = '' }: ButtonClassOptions = {}): string {
  return [VARIANT_CLASS[variant], size === 'sm' && 'btn-sm', icon && 'btn-icon', block && 'btn-block', extra].filter(Boolean).join(' ');
}
