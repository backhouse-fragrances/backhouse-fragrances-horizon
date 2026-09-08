import { Component } from '@theme/component';
import { ThemeEvents, ZoomMediaSelectedEvent } from '@theme/events';
import { StandardEvents, ProductSelectEvent } from '@shopify/events';
import { prefersReducedMotion } from '@theme/utilities';
import { scrollIntoView } from '@theme/scrolling';

/**
 * A custom element that renders a media gallery.
 *
 * @typedef {object} Refs
 * @property {import('./zoom-dialog').ZoomDialog} [zoomDialogComponent] - The zoom dialog component.
 * @property {import('./slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {HTMLElement[]} [media] - The media elements.
 * @property {HTMLElement} [gridThumbnails] - The thumbnail rail of the grid presentation.
 * @property {HTMLElement[]} [gridThumbnailButtons] - The thumbnail buttons of the grid presentation.
 *
 * @extends Component<Refs>
 */
export class MediaGallery extends Component {
  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#controller;
    const target = this.closest('.shopify-section, dialog');

    target?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });
    this.refs.zoomDialogComponent?.addEventListener(ThemeEvents.zoomMediaSelected, this.#handleZoomMediaSelected, {
      signal,
    });

    this.#observeGridMedia();
  }

  #controller = new AbortController();

  /** @type {IntersectionObserver | null} */
  #gridObserver = null;

  /** @type {Map<Element, number>} */
  #gridVisibility = new Map();

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#controller.abort();
    this.#gridObserver?.disconnect();
    this.#gridObserver = null;
  }

  /**
   * Keeps the grid thumbnail rail in sync with the media currently in view.
   */
  /** The media items of the grid presentation (refs.media also holds the mobile slideshow slides). */
  get #gridItems() {
    return /** @type {HTMLElement[]} */ (Array.from(this.querySelectorAll('.media-gallery__grid > .product-media-container')));
  }

  #observeGridMedia() {
    const { gridThumbnailButtons } = this.refs;
    const media = this.#gridItems;
    if (!gridThumbnailButtons?.length || !media.length) return;

    this.#gridObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) this.#gridVisibility.set(entry.target, entry.intersectionRatio);

        let activeIndex = -1;
        let highestRatio = 0;
        media.forEach((item, index) => {
          const ratio = this.#gridVisibility.get(item) ?? 0;
          if (ratio > highestRatio) {
            highestRatio = ratio;
            activeIndex = index;
          }
        });

        if (activeIndex >= 0) this.#setActiveGridThumbnail(activeIndex);
      },
      { threshold: Array.from({ length: 11 }, (_, i) => i / 10) }
    );

    for (const item of media) this.#gridObserver.observe(item);
  }

  /**
   * Marks a grid thumbnail as selected and keeps it visible in the rail.
   * @param {number} index - The index of the media.
   */
  #setActiveGridThumbnail(index) {
    const { gridThumbnails, gridThumbnailButtons } = this.refs;
    if (!gridThumbnailButtons) return;

    const target = gridThumbnailButtons[index];
    if (!target || target.getAttribute('aria-selected') === 'true') return;

    gridThumbnailButtons.forEach((button, i) => button.setAttribute('aria-selected', `${i === index}`));

    if (gridThumbnails) {
      scrollIntoView(target, {
        ancestor: gridThumbnails,
        behavior: prefersReducedMotion() ? 'instant' : 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }

  /**
   * Scrolls the page to a media item of the grid presentation.
   * @param {number} index - The index of the media to scroll to.
   */
  scrollToGridMedia(index) {
    const item = this.#gridItems[index];
    if (!item) return;

    this.#setActiveGridThumbnail(index);
    item.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth', block: 'start' });
  }

  /**
   * Handles a product select event by replacing the current media gallery with a new one.
   *
   * @param {ProductSelectEvent} event - The product select event.
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html } = detail;
        const newMediaGallery = html.querySelector('media-gallery');
        if (!newMediaGallery) return;

        this.replaceWith(newMediaGallery);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[media-gallery] Event promise rejected:', error);
      });
  };

  /**
   * Handles the 'zoom-media:selected' event.
   * @param {ZoomMediaSelectedEvent} event - The zoom-media:selected event.
   */
  #handleZoomMediaSelected = async (event) => {
    this.slideshow?.select(event.detail.index, undefined, { animate: false });
  };

  /**
   * Zooms the media gallery.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} event - The pointer event.
   */
  zoom(index, event) {
    this.refs.zoomDialogComponent?.open(index, event);
  }

  /**
   * Preloads an image.
   * @param {number} index - The index of the media to preload.
   */
  preloadImage(index) {
    const zoomDialogMedia = this.refs.zoomDialogComponent?.refs.media[index];
    if (!zoomDialogMedia) return;

    this.refs.zoomDialogComponent?.loadHighResolutionImage(zoomDialogMedia);
  }

  get slideshow() {
    return this.refs.slideshow;
  }

  get media() {
    return this.refs.media;
  }

  get presentation() {
    return this.dataset.presentation;
  }
}

if (!customElements.get('media-gallery')) {
  customElements.define('media-gallery', MediaGallery);
}
