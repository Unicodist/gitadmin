import * as React from 'react';
import { DEFAULT_ICON_SIZE, getIconNode, IconName } from '../helpers/icons';

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

// Decorative icon, the element that contains it must have its own label
export class Icon extends React.PureComponent<IconProps, {}> {
  render() {
    const size = this.props.size || DEFAULT_ICON_SIZE;
    const classNames = ['icon', `icon-${this.props.name}`];
    if (this.props.className) {
      classNames.push(this.props.className);
    }
    return (
      <svg className={classNames.join(' ')}
        width={size}
        height={size}
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
        focusable='false'>
        {getIconNode(this.props.name).map(([tag, attributes], i) => React.createElement(tag, { ...attributes, key: i }))}
      </svg>
    );
  }
}
