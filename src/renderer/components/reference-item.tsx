import * as React from 'react';
import { RepoWrapper, Reference } from '../helpers/repo-wrapper';
import { createReferenceContextMenu, FocusChangeHandler } from '../helpers/reference-context-menu';
import { MAX_FOCUSED_REFERENCES, isFocused, toggleFocus } from '../helpers/branch-focus';
import { InputDialogHandler } from './input-dialog';
import { getReferenceIcon } from './reference-badge';
import { Icon } from './icon';

export interface ReferenceItemProps {
  repo: RepoWrapper;
  reference: Reference;
  selected: boolean;
  focus: string[];
  // The focus or the filters leave the history of the reference out of the graph
  hidden: boolean;
  onOpenInputDialog: InputDialogHandler;
  onFocusChange: FocusChangeHandler;
  onClick: () => void;
}

export class ReferenceItem extends React.PureComponent<ReferenceItemProps, {}> {
  constructor(props: ReferenceItemProps) {
    super(props);
    this.handleClick = this.handleClick.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
    this.handleFocusToggle = this.handleFocusToggle.bind(this);
  }

  // Ctrl+click, or Cmd+click on macOS, adds the reference to the focus or removes it, like a multiple selection
  handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (event.ctrlKey || event.metaKey) {
      this.handleFocusToggle();
    } else {
      this.props.onClick();
    }
  }

  handleContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const menu = createReferenceContextMenu(this.props.repo, this.props.reference, this.props.selected, this.props.onOpenInputDialog,
      this.props.focus, this.props.onFocusChange);
    menu.popup();
  }

  handleDoubleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (!event.ctrlKey && !event.metaKey) {
      this.props.repo.checkoutReference(this.props.reference);
    }
  }

  handleFocusToggle() {
    const focus = toggleFocus(this.props.focus, this.props.reference.name());
    if (focus.length !== this.props.focus.length) {
      this.props.onFocusChange(focus);
    }
  }

  getTitle(name: string, full: boolean) {
    if (!this.props.hidden) {
      return name;
    }
    const by = this.props.focus.length > 0 ? 'the focus' : 'the filters';
    return full ? `${name} is hidden by ${by}` : `${name} is hidden by ${by}, click to show its history`;
  }

  render() {
    // selected means that the reference is the head, it is shown as the current branch
    const name = this.props.reference.shorthand();
    const focused = isFocused(this.props.focus, this.props.reference.name());
    const full = this.props.focus.length >= MAX_FOCUSED_REFERENCES;
    const classNames = ['reference-item'];
    if (this.props.selected) {
      classNames.push('current');
    }
    if (this.props.hidden) {
      classNames.push('hidden-by-focus');
    }
    return (
      <li className={focused ? 'reference-row focused' : 'reference-row'}>
        <button type='button'
          className={classNames.join(' ')}
          title={this.getTitle(name, full)}
          aria-current={this.props.selected ? 'true' : undefined}
          onClick={this.handleClick}
          onContextMenu={this.handleContextMenu}
          onDoubleClick={this.handleDoubleClick}>
          <Icon name={getReferenceIcon(this.props.reference)} className='reference-icon' />
          <span className='reference-name'>{name}</span>
          {this.props.selected ? <Icon name='check' className='reference-current' /> : null}
        </button>
        {/* Over the icon of the row, it shows on hover, when it is checked, and while the graph is focused */}
        <input type='checkbox'
          className='focus-checkbox'
          aria-label={`Focus on ${name}`}
          title={!focused && full ? `At most ${MAX_FOCUSED_REFERENCES} branches can be focused` : `Focus on ${name}`}
          checked={focused}
          disabled={!focused && full}
          onChange={this.handleFocusToggle} />
      </li>
    );
  }
}
