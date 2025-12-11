// Utility functions for Melker applications

/**
 * Format a greeting message with emojis and styling
 */
export const formatGreeting = (name: string, timeOfDay?: string): string => {
  const time = timeOfDay || getTimeOfDay();
  const emoji = getTimeEmoji(time);
  return `${emoji} Good ${time}, ${name}! Welcome to Melker!`;
};

/**
 * Get current time of day
 */
export const getTimeOfDay = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
};

/**
 * Get emoji for time of day
 */
export const getTimeEmoji = (timeOfDay: string): string => {
  switch (timeOfDay) {
    case 'morning': return '🌅';
    case 'afternoon': return '☀️';
    case 'evening': return '🌆';
    default: return '👋';
  }
};

/**
 * Validate user input with custom rules
 */
export const validateInput = (value: string, rules: { minLength?: number; maxLength?: number; required?: boolean } = {}): string | null => {
  const { minLength = 0, maxLength = Infinity, required = false } = rules;

  if (required && (!value || value.trim().length === 0)) {
    return 'This field is required';
  }

  if (value && value.length < minLength) {
    return `Must be at least ${minLength} characters long`;
  }

  if (value && value.length > maxLength) {
    return `Must be no more than ${maxLength} characters long`;
  }

  return null;
};

/**
 * Generate a random color for styling
 */
export const getRandomColor = (): string => {
  const colors = ['red', 'green', 'blue', 'yellow', 'purple', 'cyan', 'magenta'];
  return colors[Math.floor(Math.random() * colors.length)];
};

/**
 * Format current timestamp
 */
export const getCurrentTimestamp = (): string => {
  return new Date().toLocaleString();
};

/**
 * Create a status message with timestamp
 */
export const createStatusMessage = (message: string, includeTime: boolean = true): string => {
  if (includeTime) {
    return `[${getCurrentTimestamp()}] ${message}`;
  }
  return message;
};