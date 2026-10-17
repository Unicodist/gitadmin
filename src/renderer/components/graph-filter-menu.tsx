import * as React from 'react';
import {
  GraphFilters, NO_FILTERS, describeFilters, isFiltering, isLocalOnly, setLocalOnly, toggleFilter
} from '../helpers/graph-filters';
import { Icon } from './icon';

export interface GraphFilterMenuProps {
  filters: GraphFilters;
  // The focus chooses the references by itself, the filters apply again once it is cleared
  focused: boolean;
  onFiltersChange: (filters: GraphFilters) => void;
}

export interface GraphFilterMenuState {
  open: boolean;
}

interface FilterItem {
  label: string;
  checked: boolean;
  // The current branch filter leaves out everything that the other ones could hide
  enabled: boolean;
  toggle: (filters: GraphFilters) => GraphFilters;
}

const MENU_ID = 'graph-filter-menu';

// A toolbar button that opens the quick toggles of the graph. The menu stays open while the toggles
// change, so that several of them can be set at once.
export class GraphFilterMenu extends React.PureComponent<GraphFilterMenuProps, GraphFilterMenuState> {
  container: React.RefObject<HTMLDivElement | null>;
  button: React.RefObject<HTMLButtonElement | null>;
  menu: React.RefObject<HTMLDivElement | null>;

  constructor(props: GraphFilterMenuProps) {
    super(props);
    this.container = React.createRef();
    this.button = React.createRef();
    this.menu = React.createRef();
    this.state = {
      open: false
    };
    this.handleButtonClick = this.handleButtonClick.bind(this);
    this.handleButtonKeyDown = this.handleButtonKeyDown.bind(this);
    this.handleMenuKeyDown = this.handleMenuKeyDown.bind(this);
    this.handleDocumentMouseDown = this.handleDocumentMouseDown.bind(this);
  }

  componentDidUpdate(_prevProps: GraphFilterMenuProps, prevState: GraphFilterMenuState) {
    if (this.state.open && !prevState.open) {
      document.addEventListener('mousedown', this.handleDocumentMouseDown);
      this.focusItem(0);
    } else if (!this.state.open && prevState.open) {
      document.removeEventListener('mousedown', this.handleDocumentMouseDown);
    }
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleDocumentMouseDown);
  }

  getItems(): FilterItem[] {
    const filters = this.props.filters;
    const enabled = !this.props.focused && !filters.currentBranchOnly;
    return [
      {
        label: 'Current branch only',
        checked: filters.currentBranchOnly,
        enabled: !this.props.focused,
        toggle: (filters) => toggleFilter(filters, 'currentBranchOnly')
      },
      {
        label: 'Local only',
        checked: isLocalOnly(filters),
        enabled: enabled,
        toggle: (filters) => setLocalOnly(filters, !isLocalOnly(filters))
      },
      {
        label: 'Hide remote branches',
        checked: filters.hideRemotes,
        enabled: enabled,
        toggle: (filters) => toggleFilter(filters, 'hideRemotes')
      },
      {
        label: 'Hide tags',
        checked: filters.hideTags,
        enabled: enabled,
        toggle: (filters) => toggleFilter(filters, 'hideTags')
      },
      {
        label: 'Hide stashes',
        checked: filters.hideStashes,
        enabled: enabled,
        toggle: (filters) => toggleFilter(filters, 'hideStashes')
      }
    ];
  }

  open() {
    this.setState({ open: true });
  }

  close(restoreFocus: boolean) {
    this.setState({ open: false });
    if (restoreFocus && this.button.current) {
      this.button.current.focus();
    }
  }

  handleButtonClick() {
    if (this.state.open) {
      this.close(false);
    } else {
      this.open();
    }
  }

  handleButtonKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' && !this.state.open) {
      event.preventDefault();
      this.open();
    }
  }

  handleDocumentMouseDown(event: MouseEvent) {
    if (this.container.current && !this.container.current.contains(event.target as Node)) {
      this.close(false);
    }
  }

  // The enabled items, in order
  getItemElements() {
    return this.menu.current ? Array.from(this.menu.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')) : [];
  }

  focusItem(index: number) {
    const items = this.getItemElements();
    if (items.length > 0) {
      items[(index + items.length) % items.length].focus();
    }
  }

  handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = this.getItemElements();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
    } else if (event.key === 'Tab') {
      this.close(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusItem(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusItem(current < 0 ? -1 : current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      this.focusItem(-1);
    }
  }

  renderMenu() {
    const filtering = isFiltering(this.props.filters);
    return (
      <div className='graph-filter-popover' role='menu' id={MENU_ID} aria-label='Graph filters' ref={this.menu}
        onKeyDown={this.handleMenuKeyDown}>
        {this.props.focused ?
          <p className='graph-filter-hint'>The focus chooses the branches, the filters apply again once it is cleared.</p> :
          null}
        {this.getItems().map((item, i) => (
          <React.Fragment key={item.label}>
            {/* The current branch and local only are shortcuts, the other toggles hide one kind each */}
            {i === 2 ? <div className='graph-filter-separator' role='separator' /> : null}
            <button type='button'
              className='graph-filter-item'
              role='menuitemcheckbox'
              aria-checked={item.checked}
              disabled={!item.enabled}
              onClick={() => this.props.onFiltersChange(item.toggle(this.props.filters))}>
              <span className='graph-filter-check'>
                {item.checked ? <Icon name='check' size={14} /> : null}
              </span>
              {item.label}
            </button>
          </React.Fragment>
        ))}
        <div className='graph-filter-separator' role='separator' />
        <button type='button'
          className='graph-filter-item'
          role='menuitem'
          disabled={this.props.focused || !filtering}
          onClick={() => this.props.onFiltersChange(NO_FILTERS)}>
          <span className='graph-filter-check' />
          Show everything
        </button>
      </div>
    );
  }

  render() {
    // While the graph is focused, the filters wait and the button does not tell that they are on
    const active = !this.props.focused && isFiltering(this.props.filters);
    return (
      <div className='graph-filter-menu' ref={this.container}>
        <button type='button'
          className={active ? 'ghost-button filtering' : 'ghost-button'}
          title={active ? `${describeFilters(this.props.filters)} in the graph` : 'Hide kinds of references from the graph'}
          aria-haspopup='menu'
          aria-expanded={this.state.open}
          aria-controls={this.state.open ? MENU_ID : undefined}
          onClick={this.handleButtonClick}
          onKeyDown={this.handleButtonKeyDown}
          ref={this.button}>
          <Icon name='sliders-horizontal' />
          Filters
          {active ? <span className='graph-filter-dot' aria-hidden='true' /> : null}
        </button>
        {this.state.open ? this.renderMenu() : null}
      </div>
    );
  }
}
