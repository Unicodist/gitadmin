import * as React from 'react';
import { RepoWrapper, Commit } from '../helpers/repo-wrapper';
import { describeComparison, describeFocus, joinNames, shortenReferenceName } from '../helpers/branch-focus';
import { getBranchColor } from '../helpers/commit-graph';
import { Icon } from './icon';

export interface FocusBarProps {
  repo: RepoWrapper;
  focus: string[];
  onFocusChange: (focus: string[]) => void;
  onEditFocus: () => void;
  // Selects the commit and scrolls the list to it
  onCommitSelect: (commit: Commit) => void;
}

export interface FocusBarState {
  // Null until the relations are expanded or collapsed by hand
  expanded: boolean | null;
}

// Length of the SHAs in the bar
const SHORT_SHA_LENGTH = 6;

// Above the graph while it is focused: the focused branches and how they relate, the merge base on
// the first line, the fork points and the comparisons in a panel that expands
export class FocusBar extends React.PureComponent<FocusBarProps, FocusBarState> {
  constructor(props: FocusBarProps) {
    super(props);
    this.state = {
      expanded: null
    };
    this.handleRelationsToggle = this.handleRelationsToggle.bind(this);
    this.handleShowAll = this.handleShowAll.bind(this);
  }

  // A few comparisons fit in the panel, more would push the graph down
  isExpanded() {
    const relations = this.props.repo.relations;
    if (this.state.expanded !== null) {
      return this.state.expanded;
    }
    return relations !== null && relations.comparisons.length <= 1;
  }

  handleRelationsToggle() {
    this.setState({ expanded: !this.isExpanded() });
  }

  handleShowAll() {
    this.props.onFocusChange([]);
  }

  selectCommit(sha: string) {
    const commit = this.props.repo.shaToCommit.get(sha);
    if (commit) {
      this.props.onCommitSelect(commit);
    }
  }

  renderDots() {
    // The commits only take the colors of the branches when several branches are focused
    if (this.props.focus.length < 2) {
      return null;
    }
    return (
      <span className='focus-dots' aria-hidden='true'>
        {this.props.focus.map((name, i) => (
          <span className='focus-dot' style={{ backgroundColor: getBranchColor(i) }} key={name} />
        ))}
      </span>
    );
  }

  renderMergeBase() {
    const mergeBase = this.props.repo.relations!.mergeBase;
    if (mergeBase === null) {
      return <span className='focus-merge-base no-common-history'>No common history</span>;
    }
    const commit = this.props.repo.shaToCommit.get(mergeBase);
    const sha = mergeBase.substring(0, SHORT_SHA_LENGTH);
    // The flex layout drops the spaces between the parts, the label has them
    return (
      <button type='button'
        className='ghost-button small-button focus-merge-base'
        title={commit ?
          `Select the merge base, ${commit.summary()}, the best common ancestor of the focused branches` :
          'Select the merge base, the best common ancestor of the focused branches'}
        aria-label={commit ? `Merge base ${sha} ${commit.summary()}` : `Merge base ${sha}`}
        onClick={() => this.selectCommit(mergeBase)}>
        <Icon name='git-fork' size={14} />
        <span className='focus-label'>Merge base</span>
        <code>{sha}</code>
        {commit ? <span className='focus-commit-summary'>{commit.summary()}</span> : null}
      </button>
    );
  }

  renderRelations(id: string, expanded: boolean) {
    const relations = this.props.repo.relations!;
    // The merge base already tells where the branches fork from it
    const forkPoints = relations.forkPoints.filter((forkPoint) => forkPoint.sha !== relations.mergeBase);
    return (
      <div className='focus-relations' id={id} hidden={!expanded}>
        <ul className='focus-legend' aria-label='Focused branches'>
          {relations.references.map((name) => (
            <li key={name}>
              <span className='focus-dot' style={{ backgroundColor: getBranchColor(this.props.focus.indexOf(name)) }} />
              {shortenReferenceName(name)}
            </li>
          ))}
        </ul>
        {forkPoints.length > 0 ?
          <ul className='focus-fork-points' aria-label='Fork points'>
            {forkPoints.map((forkPoint) => {
              const name = shortenReferenceName(forkPoint.reference);
              const sha = forkPoint.sha.substring(0, SHORT_SHA_LENGTH);
              return (
                <li key={forkPoint.reference}>
                  <button type='button'
                    className='ghost-button small-button'
                    title={`Select the commit where ${name} leaves the other branches`}
                    aria-label={`${name} forked at ${sha}`}
                    onClick={() => this.selectCommit(forkPoint.sha)}>
                    <Icon name='git-fork' size={14} />
                    <span>{name} forked at</span>
                    <code>{sha}</code>
                  </button>
                </li>
              );
            })}
          </ul> : null}
        <ul className='focus-comparisons' aria-label='Comparisons'>
          {relations.comparisons.map((comparison) => (
            <li key={`${comparison.left} ${comparison.right}`}>{describeComparison(comparison)}</li>
          ))}
        </ul>
      </div>
    );
  }

  render() {
    const relations = this.props.repo.relations;
    const expanded = relations !== null && this.isExpanded();
    const relationsId = 'focus-relations';
    const names = joinNames(this.props.focus.map(shortenReferenceName));
    return (
      <section className='focus-bar' aria-label='Branch focus'>
        <div className='focus-summary'>
          <span className='focus-chip' title={names}>
            {this.renderDots()}
            <span className='focus-description'>{describeFocus(this.props.focus)}</span>
          </span>
          {relations ? this.renderMergeBase() : null}
          <span className='focus-actions'>
            {relations ?
              <button type='button'
                className='ghost-button small-button'
                aria-expanded={expanded}
                aria-controls={relationsId}
                onClick={this.handleRelationsToggle}>
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
                <span className='button-label'>Relations</span>
              </button> : null}
            <button type='button'
              className='ghost-button small-button'
              title='Choose the branches to show'
              aria-haspopup='dialog'
              onClick={this.props.onEditFocus}>
              <Icon name='pencil-line' size={14} />
              <span className='button-label'>Edit</span>
            </button>
            <button type='button'
              className='small-button'
              title='Show the history of every branch'
              onClick={this.handleShowAll}>
              <Icon name='x' size={14} />
              <span className='button-label'>Show all</span>
            </button>
          </span>
        </div>
        {relations ? this.renderRelations(relationsId, expanded) : null}
      </section>
    );
  }
}
