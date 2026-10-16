import * as React from 'react';
import { Icon } from './icon';

export interface ReferenceSectionProps {
  title: string;
  // Number of items, shown in the header
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}

// Collapsible section of the reference explorer
export class ReferenceSection extends React.PureComponent<ReferenceSectionProps, {}> {
  render() {
    const id = `reference-section-${this.props.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return (
      <div className='reference-section'>
        <h3>
          <button type='button'
            className='reference-section-toggle'
            aria-expanded={!this.props.collapsed}
            aria-controls={id}
            onClick={this.props.onToggle}>
            <Icon name={this.props.collapsed ? 'chevron-right' : 'chevron-down'} />
            <span className='reference-section-title'>{this.props.title}</span>
            <span className='reference-count'>{this.props.count}</span>
          </button>
        </h3>
        <ul id={id} hidden={this.props.collapsed}>
          {this.props.count > 0 ? this.props.children : <li className='reference-empty'>No {this.props.title.toLowerCase()}</li>}
        </ul>
      </div>
    );
  }
}
