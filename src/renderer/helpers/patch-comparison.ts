import { Patch } from './repo-wrapper';
export function arePatchesEqual(lhs: Patch, rhs: Patch) {
  // Files without id only exist in the working directory and cannot be compared
  return lhs.oldFile.id !== null && lhs.newFile.id !== null &&
    lhs.oldFile.id === rhs.oldFile.id &&
    lhs.newFile.id === rhs.newFile.id &&
    lhs.oldFile.path === rhs.oldFile.path &&
    lhs.newFile.path === rhs.newFile.path &&
    lhs.status === rhs.status;
}

export function arePatchesSimilar(lhs: Patch, rhs: Patch) {
  return lhs.oldFile.path === rhs.oldFile.path &&
    lhs.newFile.path === rhs.newFile.path &&
    lhs.status === rhs.status;
}