// Kinds of notifications, src/renderer/components/notification-item.tsx exports it too
export enum NotificationType {
  Information,
  Error
}

// Time for which an information toast stays on screen, in milliseconds
export const AUTO_DISMISS_DELAY = 4000;

// Delay after which a toast dismisses itself, or null if it stays until it is dismissed: errors must be read
export function getAutoDismissDelay(type: NotificationType): number | null {
  return type === NotificationType.Error ? null : AUTO_DISMISS_DELAY;
}

// Number of toasts on screen at most, the errors would pile up otherwise
export const MAX_NOTIFICATIONS = 3;

// Adds a notification after the others, the oldest ones make room for it
export function enqueueNotification<T>(notifications: T[], notification: T): T[] {
  return [...notifications, notification].slice(-MAX_NOTIFICATIONS);
}

export interface NotificationText {
  title: string;
  // Empty when the message has no details
  details: string;
}

// The errors read "Unable to push: <message of git>", the first part becomes the title of the toast
export function splitNotificationMessage(message: string): NotificationText {
  const i = message.indexOf(': ');
  if (i <= 0) {
    return { title: message.trim(), details: '' };
  }
  return { title: message.substring(0, i).trim(), details: message.substring(i + 2).trim() };
}

// Calls a function once after a delay, like setTimeout, but the time does not run while the timer is paused
export class DismissTimer {
  callback: () => void;
  remaining: number;
  startTime: number;
  timeout: ReturnType<typeof setTimeout> | null;
  finished: boolean;

  constructor(callback: () => void, delay: number) {
    this.callback = callback;
    this.remaining = delay;
    this.startTime = 0;
    this.timeout = null;
    this.finished = false;
    this.handleTimeout = this.handleTimeout.bind(this);
  }

  // Starts the timer, or resumes it with the time that was left when it was paused
  start() {
    if (this.timeout === null && !this.finished) {
      this.startTime = Date.now();
      this.timeout = setTimeout(this.handleTimeout, this.remaining);
    }
  }

  pause() {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
      this.remaining = Math.max(0, this.remaining - (Date.now() - this.startTime));
    }
  }

  // Cancels the timer for good
  stop() {
    this.pause();
    this.finished = true;
  }

  isRunning() {
    return this.timeout !== null;
  }

  handleTimeout() {
    this.timeout = null;
    this.finished = true;
    this.callback();
  }
}

// Longest transition of an element in milliseconds, 0 when the transitions are turned off (reduced motion)
export function getTransitionDuration(style: Pick<CSSStyleDeclaration, 'transitionDuration' | 'transitionDelay'>) {
  const parse = (value: string) => value.split(',').map((time) => {
    const number = parseFloat(time);
    if (Number.isNaN(number)) {
      return 0;
    }
    return time.trim().endsWith('ms') ? number : number * 1000;
  });
  const durations = parse(style.transitionDuration);
  const delays = parse(style.transitionDelay);
  return Math.max(0, ...durations.map((duration, i) => duration + (delays[i % delays.length] || 0)));
}
