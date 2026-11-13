import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn cn() helper: merges conditional class lists (clsx) and resolves
// conflicting Tailwind utility classes (tailwind-merge), e.g. cn("p-2", cond && "p-4").
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
