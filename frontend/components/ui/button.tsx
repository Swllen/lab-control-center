import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[13.5px] font-medium " +
    "transition-[background-color,box-shadow,color,transform,border-color] duration-150 active:scale-[0.98] " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-[#4a80ff] to-primary text-white shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_6px_16px_-6px_rgb(47_107_255/0.65)] " +
          "hover:from-[#5a8bff] hover:to-primary-strong",
        secondary:
          "border border-glass-border bg-tile text-fg shadow-tile hover:bg-tile-hover hover:border-line",
        ghost: "text-muted hover:bg-tile hover:text-fg",
        danger:
          "border border-transparent bg-danger-soft text-danger hover:bg-danger hover:text-white",
        "danger-solid": "bg-danger text-white shadow-[0_6px_16px_-6px_rgb(229_72_77/0.6)] hover:brightness-105",
      },
      size: {
        sm: "h-8 px-3 text-[12.5px]",
        md: "h-10 px-4",
        lg: "h-11 px-5 text-[14px]",
        icon: "size-9 rounded-full",
        "icon-sm": "size-8 rounded-lg",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
