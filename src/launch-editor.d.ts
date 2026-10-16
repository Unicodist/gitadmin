declare module 'launch-editor' {
  function launchEditor(file: string, specifiedEditor?: string, onErrorCallback?: (fileName: string, errorMessage: string) => void): void;
  export = launchEditor;
}
