import { cn } from "./utils";

type StatefulClassName<State> = string | ((state: State) => string | undefined) | undefined;

export function composeClassName<State>(base: string, className: StatefulClassName<State>) {
  if (typeof className === "function") {
    return (state: State) => cn(base, className(state));
  }

  return cn(base, className);
}
