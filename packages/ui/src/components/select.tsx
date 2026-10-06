import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "../lib/utils";

export interface SelectOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

interface SelectProps<Value extends string> {
  readonly options: readonly SelectOption<Value>[];
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly label: string;
  readonly valueLabel?: string;
  readonly id?: string;
  readonly className?: string;
}

export function Select<Value extends string>({ options, value, onValueChange, label, valueLabel, id, className }: SelectProps<Value>) {
  return (
    <SelectPrimitive.Root<Value>
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={label}
        data-slot="select-trigger"
        className={cn("inline-flex min-h-[var(--lore-size-touch)] min-w-[var(--lore-size-touch)] cursor-pointer items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--secondary)] px-3 font-[family-name:var(--lore-font-sans)] text-sm font-medium text-[var(--secondary-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] aria-expanded:bg-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", className)}
      >
        <SelectPrimitive.Value>{valueLabel}</SelectPrimitive.Value>
        <SelectPrimitive.Icon>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={6} align="start" alignItemWithTrigger={false} className="lorelum-ui z-50">
          <SelectPrimitive.Popup
            aria-label={label}
            data-slot="select-popup"
            className="min-w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--popover)] p-1 font-[family-name:var(--lore-font-sans)] text-sm text-[var(--popover-foreground)] shadow-[var(--lore-shadow-overlay)] outline-none max-h-[var(--available-height)]"
          >
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  data-value={option.value}
                  className="flex min-h-[var(--lore-size-touch)] cursor-pointer items-center justify-between gap-4 rounded-[var(--lore-radius-detail)] px-3 outline-none data-highlighted:bg-[var(--accent)] data-highlighted:text-[var(--accent-foreground)] data-selected:font-medium"
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
