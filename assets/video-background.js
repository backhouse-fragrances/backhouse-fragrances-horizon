import { Component } from '@theme/component';

/**
 * A custom element that renders a video background.
 *
 * Sources are rendered without a `src` attribute (the URL lives in
 * `data-video-source`), so nothing downloads until this element activates
 * them. Activation waits until the element is near the viewport, and is
 * skipped entirely while:
 * - `data-media` (an optional media query, e.g. `(min-width: 750px)`) does
 *   not match — used so a CSS-hidden mobile/desktop variant never downloads;
 * - the visitor prefers reduced motion (the video is hidden by CSS anyway).
 *
 * When sources carry `data-video-width`/`data-video-height`, only the
 * smallest MP4 rendition that covers the rendered box is activated instead
 * of every rendition. A natively-supported HLS stream wins over MP4.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} videoSources - The video sources.
 * @property {HTMLVideoElement} videoElement - The video element.
 *
 * @extends Component<Refs>
 */
export class VideoBackgroundComponent extends Component {
  requiredRefs = ['videoSources', 'videoElement'];

  /** @type {IntersectionObserver | null} */
  #intersectionObserver = null;

  /** @type {MediaQueryList | null} */
  #mediaQueryList = null;

  #activated = false;

  connectedCallback() {
    super.connectedCallback();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const media = this.getAttribute('data-media');

    if (media) {
      this.#mediaQueryList = window.matchMedia(media);

      if (!this.#mediaQueryList.matches) {
        this.#mediaQueryList.addEventListener('change', this.#onMediaChange);
        return;
      }
    }

    this.#observe();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#intersectionObserver?.disconnect();
    this.#mediaQueryList?.removeEventListener('change', this.#onMediaChange);
  }

  /** @param {MediaQueryListEvent} event */
  #onMediaChange = (event) => {
    if (!event.matches) return;

    this.#mediaQueryList?.removeEventListener('change', this.#onMediaChange);
    this.#observe();
  };

  #observe() {
    if (this.#activated) return;

    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        this.#intersectionObserver?.disconnect();
        this.#activate();
      },
      { rootMargin: '200px' }
    );

    this.#intersectionObserver.observe(this);
  }

  #activate() {
    if (this.#activated) return;
    this.#activated = true;

    const { videoSources, videoElement } = this.refs;

    for (const source of this.#selectSources(videoSources, videoElement)) {
      const { videoSource } = source.dataset;

      if (videoSource) source.setAttribute('src', videoSource);
    }

    videoElement.muted = true;
    videoElement.load();
    videoElement.play()?.catch(() => {});
  }

  /**
   * Picks which sources to activate for the current rendered size.
   *
   * @param {HTMLElement[]} sources
   * @param {HTMLVideoElement} videoElement
   * @returns {HTMLElement[]}
   */
  #selectSources(sources, videoElement) {
    const hlsSource = sources.find((source) =>
      (source.getAttribute('type') || '').toLowerCase().includes('mpegurl')
    );

    if (hlsSource && videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      return [hlsSource];
    }

    const mp4Sources = sources
      .filter((source) => {
        const isMp4 = (source.getAttribute('type') || '').toLowerCase() === 'video/mp4';
        return isMp4 && source.dataset.videoWidth && source.dataset.videoHeight;
      })
      .sort(
        (a, b) => Number(a.dataset.videoWidth) * Number(a.dataset.videoHeight) -
          Number(b.dataset.videoWidth) * Number(b.dataset.videoHeight)
      );

    // Markup without rendition metadata: activate everything (legacy behavior).
    if (mp4Sources.length === 0) return sources;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.getBoundingClientRect();
    const targetWidth = (rect.width || window.innerWidth) * pixelRatio;
    const targetHeight = (rect.height || window.innerHeight) * pixelRatio;

    const fittingSource = mp4Sources.find(
      (source) =>
        Number(source.dataset.videoWidth) >= targetWidth &&
        Number(source.dataset.videoHeight) >= targetHeight
    );

    return [fittingSource || mp4Sources[mp4Sources.length - 1]];
  }
}

if (!customElements.get('video-background-component')) {
  customElements.define('video-background-component', VideoBackgroundComponent);
}
