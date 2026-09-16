import { Component } from '@theme/component';

/**
 * A share control backed by the device's own share sheet.
 *
 * The button is rendered hidden on the server and revealed here only where
 * `navigator.share` exists, so a browser without Web Share shows nothing rather than a
 * control that can't do anything. The theme editor renders it unhidden regardless, so the
 * merchant can still select the block.
 *
 * @typedef {object} Refs
 * @property {HTMLButtonElement} nativeButton - The button that opens the device share sheet.
 *
 * @extends Component<Refs>
 */
export class ShareButtonsComponent extends Component {
  requiredRefs = ['nativeButton'];

  connectedCallback() {
    super.connectedCallback();

    if (typeof navigator.share === 'function') this.refs.nativeButton.hidden = false;
  }

  /** Opens the device share sheet. Bound declaratively via `on:click`. */
  async shareNatively() {
    const { shareUrl, shareTitle } = this.dataset;
    if (!shareUrl || typeof navigator.share !== 'function') return;

    try {
      await navigator.share({ title: shareTitle, url: shareUrl });
    } catch (error) {
      // The shopper dismissing the sheet is the common case and not a failure. Anything
      // else (a permissions policy blocking the call inside the editor's iframe, say) is
      // per-invocation, so the button stays put - there is no second mechanism to fall
      // back to, and removing it mid-session would be worse than a no-op.
      if (error instanceof Error && error.name !== 'AbortError') {
        console.warn('[share-buttons] share failed', error);
      }
    }
  }
}

if (!customElements.get('share-buttons-component')) {
  customElements.define('share-buttons-component', ShareButtonsComponent);
}
