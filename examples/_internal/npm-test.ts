// I want this to work
import { format, formatDistance } from "npm:date-fns"

const state = {
  currentTime: new Date(),
  birthDate: new Date(1990, 0, 15), // January 15, 1990
  formattedTime: '',
  formattedDate: '',
  timeAgo: '',
  age: ''
};

function updateTime() {
  state.currentTime = new Date();
  state.formattedTime = format(state.currentTime, 'HH:mm:ss');
  state.formattedDate = format(state.currentTime, 'EEEE, MMMM do, yyyy');
  state.timeAgo = formatDistance(state.birthDate, state.currentTime, { addSuffix: true });
  state.age = formatDistance(state.birthDate, state.currentTime);

  // Update UI elements
  const timeEl = $melker!.getElementById('time');
  const dateEl = $melker!.getElementById('date');
  const ageEl = $melker!.getElementById('age');
  const timeAgoEl = $melker!.getElementById('timeAgo');
  if (timeEl) (timeEl as any).setValue(state.formattedTime);
  if (dateEl) (dateEl as any).setValue(state.formattedDate);
  if (ageEl) (ageEl as any).setValue(state.age);
  if (timeAgoEl) (timeAgoEl as any).setValue(state.timeAgo);
}

// Initial update
updateTime();

// Update every second
setInterval(() => {
  updateTime();
  $melker!.render();
}, 1000);

export { state, updateTime };
