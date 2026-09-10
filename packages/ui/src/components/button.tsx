import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { composeClassName } from "../lib/compose-class-name";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control border border-transparent bg-clip-padding whitespace-nowrap outline-none select-none transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--lore-motion-feedback)] ease-[var(--lore-ease-feedback)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
        outline:
          "border-border-strong bg-background text-foreground hover:bg-accent hover:text-accent-foreground active:bg-muted aria-expanded:bg-accent aria-expanded:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground active:bg-muted aria-expanded:bg-accent aria-expanded:text-accent-foreground",
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground active:bg-muted aria-expanded:bg-accent aria-expanded:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-pressed focus-visible:border-destructive focus-visible:ring-destructive/25",
        link: "text-primary underline-offset-4 hover:text-primary-hover hover:underline",
      },
      size: {
        default:
          "type-label h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "type-caption h-8 gap-1.5 rounded-detail px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "type-label h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "type-label h-11 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "type-label size-10",
        "icon-xs": "type-caption size-8 rounded-detail [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "type-label size-9",
        "icon-lg": "type-label size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const baseClassName = buttonVariants({ variant, size });

  return (
    <ButtonPrimitive
      data-slot="button"
      className={composeClassName<ButtonPrimitive.State>(baseClassName, className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
