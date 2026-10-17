import * as React from 'react';
import { Reference } from '../helpers/git/model';
import { Icon } from './icon';

export interface BranchPickerProps {
  references: Reference[];
  // Full names of the chosen references, in the order they were chosen
  selected: readonly string[];
  // Most references that can be chosen
  max: number;
  onChange: (names: string[]) => void;
  // Gives the focus to the filter when the picker is shown, like in a dialog
  autoFocus?: boolean;
}

export interface BranchPickerState {
  filter: string;
}

interface ReferenceGroup {
  title: string;
  references: Reference[];
}

let pickerCount = 0;

// Checkboxes to choose a few references, grouped by kind, with a filter. It only knows the references
// and the names it is given, so that any view of the graph can embed it.
export class BranchPicker extends React.PureComponent<BranchPickerProps, BranchPickerState> {
  id: string;

  constructor(props: BranchPickerProps) {
    super(props);
    this.id = `branch-picker-${++pickerCount}`;
    this.state = {
      filter: ''
    };
    this.handleFilterChange = this.handleFilterChange.bind(this);
    this.handleClear = this.handleClear.bind(this);
  }

  handleFilterChange(event: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ filter: event.target.value });
  }

  handleClear() {
    this.props.onChange([]);
  }

  // A new name goes at the end, the order of the others does not change
  handleToggle(name: string, checked: boolean) {
    const selected = this.props.selected.filter((selectedName) => selectedName !== name);
    if (checked && selected.length < this.props.max) {
      selected.push(name);
    }
    this.props.onChange(selected);
  }

  getGroups(): ReferenceGroup[] {
    const filter = this.state.filter.trim().toLowerCase();
    const references = this.props.references
      .filter((reference) => reference.shorthand().toLowerCase().includes(filter))
      .sort((lhs, rhs) => lhs.name() <= rhs.name() ? -1 : 1);
    return [
      { title: 'Local branches', references: references.filter((reference) => reference.isBranch()) },
      { title: 'Remote branches', references: references.filter((reference) => reference.isRemote()) },
      { title: 'Tags', references: references.filter((reference) => reference.isTag()) }
    ].filter((group) => group.references.length > 0);
  }

  renderGroup(group: ReferenceGroup, full: boolean) {
    const titleId = `${this.id}-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return (
      <div className='branch-picker-group' role='group' aria-labelledby={titleId} key={group.title}>
        <h3 id={titleId}>{group.title}</h3>
        <ul>
          {group.references.map((reference) => {
            const name = reference.name();
            const checked = this.props.selected.includes(name);
            return (
              <li key={name}>
                <label className='check-field' title={reference.shorthand()}>
                  <input type='checkbox'
                    checked={checked}
                    disabled={!checked && full}
                    onChange={(event) => this.handleToggle(name, event.target.checked)} />
                  <span className='branch-picker-name'>{reference.shorthand()}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  render() {
    const groups = this.getGroups();
    const count = this.props.selected.length;
    const full = count >= this.props.max;
    return (
      <div className='branch-picker'>
        <div className='branch-picker-header'>
          <div className='search-field'>
            <Icon name='search' />
            <input type='search'
              aria-label='Filter branches'
              placeholder='Filter branches'
              value={this.state.filter}
              autoFocus={this.props.autoFocus}
              spellCheck={false}
              onChange={this.handleFilterChange} />
          </div>
          <span className='branch-picker-count'
            title={full ? `At most ${this.props.max} branches can be chosen` : undefined}
            aria-live='polite'>
            {count} of {this.props.max}
          </span>
          <button type='button'
            className='ghost-button small-button'
            disabled={count === 0}
            onClick={this.handleClear}>
            Clear
          </button>
        </div>
        <div className='branch-picker-groups'>
          {groups.length > 0 ?
            groups.map((group) => this.renderGroup(group, full)) :
            <p className='branch-picker-empty'>
              {this.props.references.length > 0 ? 'No branch matches the filter' : 'No branches'}
            </p>}
        </div>
      </div>
    );
  }
}
