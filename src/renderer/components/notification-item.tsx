import * as React from 'react';
import { DismissTimer, getAutoDismissDelay, getTransitionDuration, NotificationType, splitNotificationMessage } from '../helpers/notifications';
import { Icon } from './icon';

export { NotificationType } from '../helpers/notifications';

export interface NotificationItemProps {
  id: number;
  message: string;
  type: NotificationType;
  onRemove: (key: number) => void;
}

export interface NotificationItemState {
  leaving: boolean;
}

// A toast: the information dismisses itself unless the pointer or the focus is on it, an error stays until it is dismissed
export class NotificationItem extends React.PureComponent<NotificationItemProps, NotificationItemState> {
  li: React.RefObject<HTMLLIElement | null>;
  timer: DismissTimer | null;
  removeTimeout: ReturnType<typeof setTimeout> | null;
  hovered: boolean;
  focused: boolean;

  constructor(props: NotificationItemProps) {
    super(props);
    this.li = React.createRef();
    this.timer = null;
    this.removeTimeout = null;
    this.hovered = false;
    this.focused = false;
    this.state = {
      leaving: false
    };
    this.handleMouseEnter = this.handleMouseEnter.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.handleFocus = this.handleFocus.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.dismiss = this.dismiss.bind(this);
  }

  componentDidMount() {
    const delay = getAutoDismissDelay(this.props.type);
    if (delay !== null) {
      this.timer = new DismissTimer(this.dismiss, delay);
      this.timer.start();
    }
  }

  componentWillUnmount() {
    if (this.timer) {
      this.timer.stop();
    }
    if (this.removeTimeout !== null) {
      clearTimeout(this.removeTimeout);
    }
    // The queue removes the oldest toasts without dismissing them, to make room for new ones
    this.moveFocusAway();
  }

  handleMouseEnter() {
    this.hovered = true;
    this.updateTimer();
  }

  handleMouseLeave() {
    this.hovered = false;
    this.updateTimer();
  }

  handleFocus() {
    this.focused = true;
    this.updateTimer();
  }

  handleBlur(event: React.FocusEvent<HTMLLIElement>) {
    // The focus may only move between the elements of the toast
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      this.focused = false;
      this.updateTimer();
    }
  }

  updateTimer() {
    if (this.timer) {
      if (this.hovered || this.focused) {
        this.timer.pause();
      } else {
        this.timer.start();
      }
    }
  }

  // Plays the exit transition, then removes the toast. transitionend is not used: it never fires without transitions.
  dismiss() {
    if (this.state.leaving) {
      return;
    }
    if (this.timer) {
      this.timer.stop();
    }
    this.moveFocusAway();
    this.setState({leaving: true}, () => {
      const duration = this.li.current ? getTransitionDuration(getComputedStyle(this.li.current)) : 0;
      this.removeTimeout = setTimeout(() => this.props.onRemove(this.props.id), duration);
    });
  }

  // The focus would be lost with the toast, it goes to another toast if there is one
  moveFocusAway() {
    const li = this.li.current;
    if (!li || !li.contains(document.activeElement)) {
      return;
    }
    const button = [li.nextElementSibling, li.previousElementSibling]
      .map((sibling) => sibling ? sibling.querySelector<HTMLButtonElement>('button.notification-dismiss') : null)
      .find((button) => button !== null);
    if (button) {
      button.focus();
    } else {
      (document.activeElement as HTMLElement).blur();
    }
  }

  render() {
    const error = this.props.type === NotificationType.Error;
    const text = splitNotificationMessage(this.props.message);
    const classNames = ['notification', error ? 'error' : 'information'];
    if (this.state.leaving) {
      classNames.push('leaving');
    }
    // The queue reads the information politely, the errors interrupt
    return (
      <li ref={this.li}
        className={classNames.join(' ')}
        onMouseEnter={this.handleMouseEnter}
        onMouseLeave={this.handleMouseLeave}
        onFocus={this.handleFocus}
        onBlur={this.handleBlur}>
        <Icon name={error ? 'circle-alert' : 'info'} className='notification-icon' />
        <div className='notification-message' role={error ? 'alert' : undefined}>
          <p className='notification-title'>{text.title}</p>
          {text.details ? <p className='notification-details'>{text.details}</p> : null}
        </div>
        <button type='button'
          className='ghost-button small-button icon-button notification-dismiss'
          aria-label='Dismiss notification'
          title='Dismiss'
          onClick={this.dismiss}>
          <Icon name='x' />
        </button>
      </li>
    );
  }
}
