import * as React from 'react';
import { enqueueNotification } from '../helpers/notifications';
import { NotificationItem, NotificationType } from './notification-item';

class Notification {
  id: number;
  message: string;
  type: NotificationType;
}

export interface NotificationQueueState {
  notifications: Notification[];
  // The toasts are taller than the window, the list scrolls
  overflowing: boolean;
}

export class NotificationQueue extends React.PureComponent<{}, NotificationQueueState> {
  counter: number;
  list: React.RefObject<HTMLUListElement | null>;

  constructor(props: {}) {
    super(props);
    this.counter = 0;
    this.list = React.createRef();
    this.state = {
      notifications: [],
      overflowing: false
    };
    this.removeNotification = this.removeNotification.bind(this);
    this.scrollToNewest = this.scrollToNewest.bind(this);
    this.updateOverflow = this.updateOverflow.bind(this);
  }

  componentDidMount() {
    window.addEventListener('resize', this.updateOverflow);
  }

  componentDidUpdate() {
    this.updateOverflow();
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateOverflow);
  }

  addNotification(message: string, type: NotificationType) {
    const notification = {id: this.counter, message: message, type: type};
    ++this.counter;
    this.setState((prevState) => ({
      notifications: enqueueNotification(prevState.notifications, notification)
    }), this.scrollToNewest);
  }

  removeNotification(id: number) {
    this.setState((prevState) => ({
      notifications: prevState.notifications.filter((notification) => notification.id !== id)
    }));
  }

  // The newest toast is the last one, it must be seen even if the list scrolls
  scrollToNewest() {
    if (this.list.current) {
      this.list.current.scrollTop = this.list.current.scrollHeight;
    }
  }

  updateOverflow() {
    const list = this.list.current;
    const overflowing = list !== null && list.scrollHeight > list.clientHeight;
    if (overflowing !== this.state.overflowing) {
      this.setState({overflowing: overflowing});
    }
  }

  render() {
    // Notification items
    const notificationItems = this.state.notifications.map((notification) =>
      <NotificationItem message={notification.message}
        type={notification.type}
        onRemove={this.removeNotification}
        id={notification.id}
        key={notification.id} />
    );

    // A live region must be in the page before its content, so the list is rendered even when it is empty
    return (
      <ul ref={this.list}
        className={this.state.overflowing ? 'notification-queue overflowing' : 'notification-queue'}
        aria-live='polite'
        aria-label='Notifications'>
        {notificationItems}
      </ul>
    );
  }
}
