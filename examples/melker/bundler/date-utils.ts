// External script demonstrating npm: imports with the new bundler
// This requires: deno run --unstable-bundle --allow-all melker.ts

import { format } from "npm:date-fns";

// Update all date displays
function updateDates(): void {
  const now = new Date();

  const dateEl = context.getElementById("date");
  const timeEl = context.getElementById("time");
  const dayEl = context.getElementById("day");

  if (dateEl) dateEl.props.text = format(now, "MMMM do, yyyy");
  if (timeEl) timeEl.props.text = format(now, "HH:mm:ss");
  if (dayEl) dayEl.props.text = format(now, "EEEE");
}

// Export for use in inline handlers and ready hook
export { updateDates };
