// External script demonstrating npm: imports with the new bundler
// This requires: deno run --unstable-bundle --allow-all melker.ts

import { format } from "npm:date-fns";

// Update all date displays
function updateDates(): void {
  const now = new Date();

  const dateEl = $melker!.getElementById("date");
  const timeEl = $melker!.getElementById("time");
  const dayEl = $melker!.getElementById("day");

  if (dateEl) (dateEl as any).setValue(format(now, "MMMM do, yyyy"));
  if (timeEl) (timeEl as any).setValue(format(now, "HH:mm:ss"));
  if (dayEl) (dayEl as any).setValue(format(now, "EEEE"));
}

// Export for use in inline handlers and ready hook
export { updateDates };
