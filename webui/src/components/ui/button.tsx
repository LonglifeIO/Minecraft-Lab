import { forwardRef, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variantStyles = {
  default: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  destructive: "bg-red-600 text-white hover:bg-red-700",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  warning: "bg-amber-600 text-white hover:bg-amber-700",
  outline: "border border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800",
  ghost: "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
};

const sizeStyles = {
  default: "h-10 px-4 py-2 text-sm",
  sm: "h-8 px-3 text-xs",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", disabled, ...props }, ref) => (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        "disabled:opacity-50 disabled:pointer-events-none",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      ref={ref}
      disabled={disabled}
      {...props}
    />
  ),
);
Button.displayName = "Button";
export { Button };
