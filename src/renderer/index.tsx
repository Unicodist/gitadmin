import { ipcRenderer } from 'electron';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/app';

let app: App;

function setAppRef(a: App | null) {
  if (a) {
    app = a;
  }
}

function render() {
  createRoot(document.getElementById('container')!).render(<App ref={setAppRef} />);
}

render();

// Events

ipcRenderer.on('clone-repo', () => {
  if (app) {
    app.openCloneRepoDialog();
  }
});

ipcRenderer.on('init-repo', () => {
  if (app) {
    app.openInitRepoDialog();
  }
});

ipcRenderer.on('open-repo', () => {
  if (app) {
    app.openOpenRepoDialog();
  }
});

ipcRenderer.on('preferences', () => {
  if (app) {
    app.openPreferencesDialog();
  }
});

// Unhandled exceptions

function handleError(e: any) {
  // This was necessary for node-watch, is it still necessary for chokidar?
  if (e && (e.code === 'ENOTDIR' || e.code === 'ENOENT')) {
    console.log(e);
  } else {
    console.error(e);
  }
}

window.addEventListener('error', (event) => {
  event.preventDefault();
  handleError(event.error || new Error(event.message));
});

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  handleError(event.reason);
});