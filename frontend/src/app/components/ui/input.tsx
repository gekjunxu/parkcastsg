import * as React from "react";

import { cn } from "./utils";

export type InputAppearance = "default" | "bare";

type InputProps = React.ComponentProps<"input"> & {
  appearance?: InputAppearance;
};

const inputBaseClasses =
  "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 flex min-w-0 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const inputAppearanceClasses: Record<InputAppearance, string> = {
  default: "h-9 w-full rounded-md border border-input bg-input-background px-3 py-1",
  bare: "w-full rounded-none border-0 bg-transparent px-0 py-0",
};

const inputFocusClasses: Record<InputAppearance, string> = {
  default: "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  bare: "focus-visible:ring-0",
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, appearance = "default", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        inputBaseClasses,
        inputAppearanceClasses[appearance],
        inputFocusClasses[appearance],
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";

export { Input };
