import * as React from 'react';
import { IconName } from '../helpers/icons';
import { Icon } from './icon';

export interface SpinnerButtonProps {
  value: string;
  onClick: () => Promise<void>;
  // Shown before the label, the spinner takes its place while the action runs
  icon?: IconName;
  className?: string;
  title?: string;
}

export interface SpinnerButtonState {
  waiting: boolean;
}

// Shows a spinner until the action is done, the label stays so that the width does not change
export class SpinnerButton extends React.PureComponent<SpinnerButtonProps, SpinnerButtonState> {
  constructor(props: SpinnerButtonProps) {
    super(props);
    this.state = {
      waiting: false
    };
    this.handleClick = this.handleClick.bind(this);
  }

  async handleClick() {
    // The button is only disabled for assistive technologies, so it ignores the clicks itself
    if (this.state.waiting) {
      return;
    }
    this.setState({waiting: true});
    try {
      await this.props.onClick();
    } finally {
      this.setState({waiting: false});
    }
  }

  render() {
    const waiting = this.state.waiting;
    const classNames = ['spinner-button'];
    if (!this.props.icon) {
      classNames.push('without-icon');
    }
    if (this.props.className) {
      classNames.push(this.props.className);
    }
    let indicator = null;
    if (waiting) {
      indicator = <Icon name='loader-circle' className='spinner-icon' />;
    } else if (this.props.icon) {
      indicator = <Icon name={this.props.icon} />;
    }
    // aria-disabled rather than disabled, a disabled button would lose the keyboard focus
    return (
      <button type='button'
        className={classNames.join(' ')}
        title={this.props.title}
        aria-disabled={waiting}
        aria-busy={waiting}
        onClick={this.handleClick}>
        {indicator}
        <span className='spinner-button-label'>{this.props.value}</span>
      </button>
    );
  }
}
