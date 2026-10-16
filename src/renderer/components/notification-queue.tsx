import * as React from 'react';
import { NotificationItem, NotificationType } from './notification-item';

class Notification {
  id: number;
  message: string;
  type: NotificationType;
}

export interface NotificationQueueState {
  notifications: Notification[];
}

export class NotificationQueue extends React.PureComponent<{}, NotificationQueueState> {
  counter: number;

  constructor(props: {}) {
    super(props);
    this.counter = 0;
    this.state = {
      notifications: []
    };
    this.removeNotification = this.removeNotification.bind(this);
  }

  addNotification(message: string, type: NotificationType) {
    const notification = {id: this.counter, message: message, type: type};
    ++this.counter;
    this.setState((prevState) => ({
      notifications: [...prevState.notifications, notification]
    }));
  }

  removeNotification(id: number) {
    this.setState((prevState) => ({
      notifications: prevState.notifications.filter((notification) => notification.id !== id)
    }));
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
      <ul className='notification-queue' aria-live='polite' aria-label='Notifications'>
        {notificationItems}
      </ul>
    );
  }
}
