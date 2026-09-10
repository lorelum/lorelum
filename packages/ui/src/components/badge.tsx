import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "group/badge type-caption inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 whitespace-nowrap outline-none transition-[background-color,color,border-color,box-shadow] duration-[var(--lore-motion-feedback)] ease-[var(--lore-ease-feedback)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-secondary text-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground focus-visible:ring-destructive/25 [a]:hover:bg-destructive-hover",
        outline:
          "border-border-strong text-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:text-primary-hover hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
