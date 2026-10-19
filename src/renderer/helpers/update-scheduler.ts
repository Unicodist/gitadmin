// Time the watchers gather changes before the repository is updated: git writes one file per reference, a fetch
// that moves many branches is then a single update
export const UPDATE_DELAY = 150;

export interface Changes {
  // A reference or the head moved
  references: boolean;
  // The index or the working directory changed
  index: boolean;
}

// Gathers the changes that the watchers see and handles them together. There is at most one update at once, the
// changes seen in the meantime make the next one, and none starts while the repository is busy.
export class UpdateScheduler {
  // Null when nothing changed since the last update
  private pending: Changes | null;
  private timer: NodeJS.Timeout | null;
  private running: boolean;
  private stopped: boolean;
  private readonly update: (changes: Changes) => Promise<void>;
  private readonly isBusy: () => boolean;
  private readonly delay: number;

  constructor(update: (changes: Changes) => Promise<void>, isBusy: () => boolean, delay = UPDATE_DELAY) {
    this.pending = null;
    this.timer = null;
    this.running = false;
    this.stopped = false;
    this.update = update;
    this.isBusy = isBusy;
    this.delay = delay;
  }

  // Something changed, the update reads the state of the repository in any case
  schedule(references: boolean, index: boolean) {
    this.pending = {
      references: references || (this.pending !== null && this.pending.references),
      index: index || (this.pending !== null && this.pending.index)
    };
    this.start();
  }

  // The repository is not busy anymore
  resume() {
    if (this.pending !== null) {
      this.start();
    }
  }

  private start() {
    if (this.timer === null && !this.running && !this.stopped) {
      this.timer = setTimeout(() => this.run(), this.delay);
    }
  }

  // No update starts anymore
  stop() {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async run() {
    this.timer = null;
    if (this.isBusy() || this.pending === null) {
      return;
    }
    const changes = this.pending;
    this.pending = null;
    this.running = true;
    try {
      await this.update(changes);
    } finally {
      this.running = false;
      this.resume();
    }
  }
}
