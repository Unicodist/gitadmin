import * as React from 'react';
import { Icon } from './icon';
import { DEFAULT_FILTERS, FILTER_NAMES, GraphFilters, GraphMode, isFilterImplied, isFilterOn } from '../helpers/graph-filters';

export interface GraphHeaderProps {
  mode: GraphMode;
  filters: GraphFilters;
  // The focus chooses the references, the filters do not apply then
  focused: boolean;
  highlight: string;
  // Number of commits that match the highlight, null when nothing is highlighted
  matchCount: number | null;
  onModeChange: (mode: GraphMode) => void;
  onFiltersChange: (filters: GraphFilters) => void;
  onHighlightChange: (highlight: string) => void;
  // Selects the next commit that matches, or the previous one
  onFindMatch: (forward: boolean) => void;
}

export interface GraphHeaderState {
  filtersOpen: boolean;
}

const FILTER_LABELS: Record<keyof GraphFilters, string> = {
  currentBranchOnly: 'Current branch only',
  localOnly: 'Local branches only',
  hideRemotes: 'Hide remote branches',
  hideTags: 'Hide tags',
  hideStashes: 'Hide stashes'
};

const MODES: [GraphMode, string, 'list' | 'waypoints'][] = [
  [GraphMode.List, 'List', 'list'],
  [GraphMode.Canvas, 'Canvas', 'waypoints']
];

const MODE_TITLES: Record<GraphMode, string> = {
  [GraphMode.List]: 'Show the commits as a list next to the graph',
  [GraphMode.Canvas]: 'Show the graph on a canvas that can be moved and zoomed'
};

// Above the graph: the list or the canvas, the quick filters of the history, and the highlight of commits
export class GraphHeader extends React.PureComponent<GraphHeaderProps, GraphHeaderState> {
  filters: React.RefObject<HTMLDivElement | null>;

  constructor(props: GraphHeaderProps) {
    super(props);
    this.filters = React.createRef();
    this.state = {
      filtersOpen: false
    };
    this.handleFiltersToggle = this.handleFiltersToggle.bind(this);
    this.handleFiltersReset = this.handleFiltersReset.bind(this);
    this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.handleFiltersKeyDown = this.handleFiltersKeyDown.bind(this);
    this.handleHighlightChange = this.handleHighlightChange.bind(this);
    this.handleHighlightKeyDown = this.handleHighlightKeyDown.bind(this);
  }

  componentDidUpdate(_prevProps: GraphHeaderProps, prevState: GraphHeaderState) {
    if (this.state.filtersOpen !== prevState.filtersOpen) {
      if (this.state.filtersOpen) {
        document.addEventListener('pointerdown', this.handleDocumentPointerDown);
      } else {
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
      }
    }
  }

  componentWillUnmount() {
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
  }

  handleFiltersToggle() {
    this.setState((prevState) => ({ filtersOpen: !prevState.filtersOpen }));
  }

  // The panel closes when something else is clicked
  handleDocumentPointerDown(event: PointerEvent) {
    if (this.filters.current && !this.filters.current.contains(event.target as Node)) {
      this.setState({ filtersOpen: false });
    }
  }

  handleFiltersKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && this.state.filtersOpen) {
      event.stopPropagation();
      this.setState({ filtersOpen: false });
      const button = this.filters.current && this.filters.current.querySelector('button');
      if (button) {
        button.focus();
      }
    }
  }

  handleFilterChange(name: keyof GraphFilters, checked: boolean) {
    this.props.onFiltersChange({ ...this.props.filters, [name]: checked });
  }

  handleFiltersReset() {
    this.props.onFiltersChange(DEFAULT_FILTERS);
  }

  handleHighlightChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.props.onHighlightChange(event.target.value);
  }

  handleHighlightKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.props.onFindMatch(!event.shiftKey);
    }
  }

  getActiveFilterCount() {
    return FILTER_NAMES.filter((name) => this.props.filters[name]).length;
  }

  renderModes() {
    return (
      <div className='segmented-control graph-mode' role='radiogroup' aria-label='Graph view'>
        {MODES.map(([mode, label, icon]) => (
          <React.Fragment key={mode}>
            <input type='radio'
              id={`graph-mode-${mode}`}
              name='graph-mode'
              checked={this.props.mode === mode}
              onChange={() => this.props.onModeChange(mode)} />
            <label htmlFor={`graph-mode-${mode}`} title={MODE_TITLES[mode]}>
              <Icon name={icon} size={14} />
              <span className='button-label'>{label}</span>
            </label>
          </React.Fragment>
        ))}
      </div>
    );
  }

  renderFilters() {
    const count = this.getActiveFilterCount();
    const filters = this.props.filters;
    const panelId = 'graph-filters-panel';
    return (
      <div className='graph-filters' ref={this.filters} onKeyDown={this.handleFiltersKeyDown}>
        <button type='button'
          className={count > 0 && !this.props.focused ? 'ghost-button small-button active-filters' : 'ghost-button small-button'}
          aria-expanded={this.state.filtersOpen}
          aria-controls={panelId}
          title={this.props.focused ?
            'The focus chooses the branches, the filters apply while every branch is shown' :
            'Choose which history the graph shows'}
          onClick={this.handleFiltersToggle}>
          <Icon name='list-filter' size={14} />
          <span className='button-label'>Filters</span>
          {count > 0 ? <span className='filter-count' aria-label={`${count} on`}>{count}</span> : null}
          <Icon name='chevron-down' size={14} />
        </button>
        <div className='graph-filters-panel' id={panelId} role='group' aria-label='Filters' hidden={!this.state.filtersOpen}>
          {this.props.focused ?
            <p className='field-hint'>The focus chooses the branches. The filters apply again when every branch is shown.</p> : null}
          {FILTER_NAMES.map((name) => (
            <label className='check-field' key={name}>
              <input type='checkbox'
                checked={isFilterOn(filters, name)}
                disabled={this.props.focused || isFilterImplied(filters, name)}
                onChange={(event) => this.handleFilterChange(name, event.target.checked)} />
              <span>{FILTER_LABELS[name]}</span>
            </label>
          ))}
          <button type='button'
            className='ghost-button small-button'
            disabled={count === 0 || this.props.focused}
            onClick={this.handleFiltersReset}>
            Show everything
          </button>
        </div>
      </div>
    );
  }

  renderHighlight() {
    const count = this.props.matchCount;
    return (
      <div className='graph-highlight'>
        <div className='search-field'>
          <Icon name='search' />
          <input type='search'
            aria-label='Highlight commits'
            placeholder='Highlight commits'
            title='Words of the message, the author or the SHA, and after:2024-01-31 or before:2024-02. Enter goes to the next match.'
            value={this.props.highlight}
            spellCheck={false}
            onChange={this.handleHighlightChange}
            onKeyDown={this.handleHighlightKeyDown} />
        </div>
        {count !== null ?
          <span className='highlight-count' aria-live='polite'>
            {count === 0 ? 'No match' : `${count} ${count === 1 ? 'match' : 'matches'}`}
          </span> : null}
      </div>
    );
  }

  render() {
    return (
      <div className='graph-header' role='group' aria-label='Graph options'>
        {this.renderModes()}
        {this.renderFilters()}
        {this.renderHighlight()}
      </div>
    );
  }
}
