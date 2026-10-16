import * as React from 'react';

export enum LoadingState {
  NotLoading,
  Loaded
}

export interface LoadingScreenProps {
  state: LoadingState
}

export class LoadingScreen extends React.PureComponent<LoadingScreenProps, {}> {
  render() {
    return (
      <div className='loading-screen' role='status'>
        <div className='spinner' />
        <p>Loading repository</p>
      </div>
    );
  }
}
