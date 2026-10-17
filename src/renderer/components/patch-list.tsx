import * as React from 'react';
import { PatchItem } from './patch-item';
import { Icon } from './icon';
import { RepoWrapper, PatchType, Patch } from '../helpers/repo-wrapper';

// Util

function generatePatchKey(patch: Patch) {
  return `${patch.status}${patch.oldFile.path}${patch.newFile.path}`;
}

function addOrDelete(selectedPatches: Set<Patch>, patch: Patch) {
  if (selectedPatches.has(patch)) {
    selectedPatches.delete(patch);
  } else {
    selectedPatches.add(patch);
  }
}

function addRange(patches: Patch[], selectedPatches: Set<Patch>, start: number, end: number) {
  if (start > end) {
    [start, end] = [end, start];
  }
  patches.slice(start, end + 1).forEach((patch) => selectedPatches.add(patch));
}

function deleteRange(patches: Patch[], selectedPatches: Set<Patch>, start: number, end: number) {
  if (start > end) {
    [start, end] = [end, start];
  }
  patches.slice(start, end + 1).forEach((patch) => selectedPatches.delete(patch));
}

// Patch list

export interface PatchListProps {
  repo?: RepoWrapper
  patches: Patch[];
  type: PatchType;
  selectedPatch: Patch | null;
  selectedPatches?: Set<Patch>;
  onPatchSelect: (patch: Patch) => void;
  onSelectedPatchesChange?: (selectedPatches: Set<Patch>) => void;
}

export class PatchList extends React.PureComponent<PatchListProps, {}> {
  iPatch: number;
  iAnchor: number;
  iShift: number | null;

  constructor(props: PatchListProps) {
    super(props);
    this.iShift = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handlePatchSelect = this.handlePatchSelect.bind(this);
  }

  handlePatchSelect(patch: Patch, ctrlKey: boolean, shiftKey: boolean) {
    this.iPatch = this.props.patches.indexOf(patch);
    if (this.props.selectedPatches && this.props.selectedPatches.size > 0 && ctrlKey) {
      const selectedPatches = new Set(this.props.selectedPatches);
      addOrDelete(selectedPatches, patch);
      this.iAnchor = this.iPatch;
      this.iShift = null;
      this.props.onSelectedPatchesChange!(selectedPatches);
    } else if (this.props.selectedPatches && this.props.selectedPatches.size > 0 && shiftKey) {
      const selectedPatches = new Set(this.props.selectedPatches);
      if (this.iShift !== null) {
        deleteRange(this.props.patches, selectedPatches, this.iAnchor, this.iShift);
      }
      addRange(this.props.patches, selectedPatches, this.iAnchor, this.iPatch);
      this.iShift = this.iPatch;
      this.props.onSelectedPatchesChange!(selectedPatches);
    } else {
      this.iAnchor = this.iPatch;
      this.iShift = null;
      this.props.onPatchSelect(patch);
    }
  }

  handleKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const patches = this.props.patches;
    // The buttons of the rows keep their own keys
    if (event.target !== event.currentTarget || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || patches.length === 0) {
      return;
    }
    // The arrows move the selection, which scrolls into view by itself
    event.preventDefault();
    const selectedPatch = this.props.selectedPatch;
    if (selectedPatch && patches.includes(selectedPatch)) {
      // The selection may have been changed by the viewer since the last key
      this.iPatch = patches.indexOf(selectedPatch);
      this.iAnchor = this.iPatch;
    } else if (!this.props.selectedPatches || this.props.selectedPatches.size === 0 || this.iPatch === undefined) {
      // Nothing is selected in this list yet
      this.handlePatchSelect(patches[event.key === 'ArrowDown' ? 0 : patches.length - 1], false, false);
      return;
    }
    if (event.key === 'ArrowUp' && this.iPatch > 0) {
      this.handlePatchSelect(patches[this.iPatch - 1], event.ctrlKey, event.shiftKey);
    } else if (event.key === 'ArrowDown' && this.iPatch < patches.length - 1) {
      this.handlePatchSelect(patches[this.iPatch + 1], event.ctrlKey, event.shiftKey);
    }
  }

  renderEmptyState() {
    // The files of a commit are loaded after the list is shown, an empty state would flash
    if (this.props.type === PatchType.Committed) {
      return null;
    }
    const unstaged = this.props.type === PatchType.Unstaged;
    return (
      <li className='patch-list-empty'>
        <Icon name={unstaged ? 'circle-check' : 'inbox'} size={24} />
        <span>{unstaged ? 'No unstaged changes' : 'No staged changes'}</span>
      </li>
    );
  }

  render() {
    // Patch items
    const patchItems = this.props.patches.map((patch) => {
      const selected = patch === this.props.selectedPatch || (this.props.selectedPatches !== undefined && this.props.selectedPatches.has(patch));
      return <PatchItem repo={this.props.repo}
        patch={patch}
        type={this.props.type}
        selected={selected}
        onPatchSelect={this.handlePatchSelect}
        key={generatePatchKey(patch)} />;
    });

    // An empty list stays focusable, it may have the focus when its last file is staged
    return (
      <ul className={patchItems.length > 0 ? 'patch-list' : 'patch-list empty'} tabIndex={0} onKeyDown={this.handleKeyDown}>
        {patchItems.length > 0 ? patchItems : this.renderEmptyState()}
      </ul>
    );
  }
}
