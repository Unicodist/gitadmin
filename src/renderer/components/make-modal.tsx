import * as React from 'react';
import { Icon } from './icon';

interface WrappedComponentProps {
  onClose: () => void;
}

type ModalComponentProps<P> = P & {title: string};

interface ComponentConstructor<P, S> {
  new(props: P): React.PureComponent<P, S>;
}

const FOCUSABLE_SELECTOR = ['a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]'].map((selector) => `${selector}:not([tabindex="-1"])`).join(', ');

// Elements of a dialog that Tab goes through, in order, without the hidden ones (the other sections of the preferences)
function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0);
}

let modalCount = 0;

// Shows a component in a dialog over the page. The dialog takes the focus and keeps it until it is closed,
// then gives it back to the element that had it.
export function makeModal<P extends WrappedComponentProps, S>(Component: ComponentConstructor<P, S>) {
  return class extends React.PureComponent<ModalComponentProps<P>, S> {
    dialog: React.RefObject<HTMLDivElement | null>;
    titleId: string;
    previousFocus: Element | null;
    lastFocus: EventTarget | null;
    focusEntered: boolean;
    // Escape closes the dialog when it is released, only if it was pressed in the dialog
    escapePressed: boolean;

    constructor(props: ModalComponentProps<P>) {
      super(props);
      this.dialog = React.createRef();
      this.titleId = `modal-title-${++modalCount}`;
      // Read before the field of the dialog takes the focus
      this.previousFocus = document.activeElement;
      this.lastFocus = null;
      this.focusEntered = false;
      this.escapePressed = false;
      this.handleFocus = this.handleFocus.bind(this);
      this.handleDocumentFocusIn = this.handleDocumentFocusIn.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleKeyUp = this.handleKeyUp.bind(this);
      this.handleBackdropMouseDown = this.handleBackdropMouseDown.bind(this);
    }

    componentDidMount() {
      // The field with autoFocus has the focus already, otherwise the dialog itself takes it
      const dialog = this.dialog.current;
      if (dialog && !dialog.contains(document.activeElement)) {
        dialog.focus();
      }
      document.addEventListener('focusin', this.handleDocumentFocusIn);
    }

    componentWillUnmount() {
      document.removeEventListener('focusin', this.handleDocumentFocusIn);
      const previousFocus = this.previousFocus;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    }

    handleFocus(event: React.FocusEvent<HTMLDivElement>) {
      // When this dialog replaces another one, the other one gives the focus back to its own opener just before,
      // the element that loses the focus at the first focus of the dialog is the one to give it back to
      const relatedTarget = event.relatedTarget;
      if (!this.focusEntered && relatedTarget instanceof HTMLElement && !event.currentTarget.contains(relatedTarget)) {
        this.previousFocus = relatedTarget;
      }
      this.focusEntered = true;
      this.lastFocus = event.target;
    }

    // The focus can still leave the dialog: to a notification, which is above the dialog, with Tab after the notification,
    // or to a component under the dialog that takes it. It comes back to the dialog, unless it is on a notification or
    // in another dialog, like a prompt for credentials over the dialog.
    handleDocumentFocusIn(event: FocusEvent) {
      const dialog = this.dialog.current;
      const target = event.target;
      if (!dialog || !(target instanceof Element) || dialog.contains(target) || target.closest('.notification-queue, .modal-backdrop')) {
        return;
      }
      if (this.lastFocus instanceof HTMLElement && dialog.contains(this.lastFocus)) {
        this.lastFocus.focus();
      }
      // The element that had the focus may be hidden now, like the fields of another section of the preferences
      if (!dialog.contains(document.activeElement)) {
        dialog.focus();
      }
    }

    handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
      if (event.key === 'Escape') {
        this.escapePressed = !event.nativeEvent.isComposing;
        event.nativeEvent.stopPropagation();
      } else if (event.key === 'Tab') {
        this.trapFocus(event);
      }
    }

    handleKeyUp(event: React.KeyboardEvent<HTMLDivElement>) {
      if (event.key === 'Escape' && this.escapePressed) {
        this.escapePressed = false;
        this.props.onClose();
      }
      // The patch viewer closes on the keyup of Escape on the window, the dialog keeps its keys
      event.nativeEvent.stopPropagation();
    }

    // Tab goes from the last element of the dialog to the first one, and Shift+Tab the other way
    trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
      const dialog = this.dialog.current;
      if (!dialog) {
        return;
      }
      const elements = getFocusableElements(dialog);
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const outside = active === null || !elements.includes(active);
      if (event.shiftKey && (outside || active === elements[0])) {
        event.preventDefault();
        elements[elements.length - 1].focus();
      } else if (!event.shiftKey && (outside || active === elements[elements.length - 1])) {
        event.preventDefault();
        elements[0].focus();
      }
    }

    // A click on the backdrop leaves the focus where it is
    handleBackdropMouseDown(event: React.MouseEvent<HTMLDivElement>) {
      if (event.target === event.currentTarget) {
        event.preventDefault();
      }
    }

    render() {
      return (
        <div className='modal-backdrop'
          onFocus={this.handleFocus}
          onKeyDown={this.handleKeyDown}
          onKeyUp={this.handleKeyUp}
          onMouseDown={this.handleBackdropMouseDown}>
          <div className='modal-dialog'
            role='dialog'
            aria-modal='true'
            aria-labelledby={this.titleId}
            tabIndex={-1}
            ref={this.dialog}>
            <div className='modal-header'>
              <h2 id={this.titleId}>{this.props.title}</h2>
              <button type='button'
                className='ghost-button icon-button modal-close'
                aria-label='Close dialog'
                title='Close'
                onClick={this.props.onClose}>
                <Icon name='x' />
              </button>
            </div>
            <Component {...this.props} />
          </div>
        </div>
      );
    }
  };
}
