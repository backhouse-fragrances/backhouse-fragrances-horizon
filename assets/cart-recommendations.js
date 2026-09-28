import { Component } from '@theme/component';
import { StandardEvents } from '@shopify/events';

/**
 * @typedef {object} Refs
 * @property {HTMLElement} container - Receives the fetched recommendations markup.
 */

/**
 * A custom element that renders the cart recommendations (upsell) widget in the cart
 * drawer and on the cart page.
 *
 * Unlike the stock `<product-recommendations>` element (see `product-recommendations.js`),
 * this component INJECTS the fetched markup into its own `container` ref instead of
 * calling `morphSection`. A morph replaces the entire section element it targets, which is
 * fine on a product page but not here: in the cart drawer this element lives inside the
 * drawer's live DOM (open state, scroll position), and morphing the section that contains
 * it would clobber the drawer along with it. Injection only ever touches this element's
 * own subtree, so the surrounding drawer/page markup is left alone.
 *
 * Markup for this element is rendered by `snippets/cart-recommendations.liquid` (the
 * placeholder/seed, used by both the cart page and the cart drawer) and
 * `sections/cart-recommendations.liquid` (the fetched content, rendered only once the
 * request carries `product_id` + `intent`, i.e. `recommendations.performed`).
 *
 * @extends {Component<Refs>}
 */
class CartRecommendations extends Component {
  requiredRefs = ['container'];

  /**
   * The cached recommendations HTML, keyed by request URL.
   * @type {Record<string, string>}
   */
  #cachedRecommendations = {};

  /**
   * An abort controller for the active fetch (if there is one).
   * @type {AbortController | null}
   */
  #activeFetch = null;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartUpdate);
    this.#loadRecommendations();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(StandardEvents.cartLinesUpdate, this.#handleCartUpdate);
    this.#activeFetch?.abort();
  }

  /**
   * Re-fetches recommendations once a cart change (add/remove/update) resolves. The cart
   * may now contain a product this widget already recommended, or may have emptied
   * entirely; both are re-evaluated server-side by `sections/cart-recommendations.liquid`
   * (it filters `recommendations.products` against the live `cart` object and renders
   * nothing when `cart.item_count` is 0), so a forced, non-cached re-fetch is enough to
   * stay correct without re-deriving anything on the client.
   * @param {import('@shopify/events').CartLinesUpdateEvent} event
   */
  #handleCartUpdate = (event) => {
    event.promise
      ?.then(() => {
        this.#loadRecommendations({ force: true });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[cart-recommendations] Event promise rejected:', error);
      });
  };

  /**
   * Loads the recommendations markup and injects it into the container ref.
   * @param {{ force?: boolean }} [options]
   */
  #loadRecommendations({ force = false } = {}) {
    const { productId, sectionId, intent } = this.dataset;

    if (!productId || !sectionId) {
      throw new Error('Product ID and a section ID are required');
    }

    this.#fetchRecommendations(productId, sectionId, intent, force)
      .then((result) => {
        if (!result.success) {
          this.#handleError(new Error(`Server returned ${result.status}`));
          return;
        }

        const markup = this.#extractSectionMarkup(result.data, sectionId);

        if (markup.length) {
          this.classList.remove('hidden');
          this.refs.container.innerHTML = markup;
        } else {
          this.#handleError(new Error('No recommendations available'));
        }
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        this.#handleError(error);
      });
  }

  /**
   * Fetches the recommendations markup, caching the result per URL like
   * `<product-recommendations>` does, unless a fresh (cart-change-triggered) fetch is
   * forced.
   * @param {string} productId
   * @param {string} sectionId
   * @param {string | undefined} intent
   * @param {boolean} force
   * @returns {Promise<{ success: true, data: string } | { success: false, status: number }>}
   */
  async #fetchRecommendations(productId, sectionId, intent, force) {
    const url = `${this.dataset.url}&product_id=${productId}&section_id=${sectionId}&intent=${intent}`;

    if (force) {
      delete this.#cachedRecommendations[url];
    } else {
      const cachedResponse = this.#cachedRecommendations[url];
      if (cachedResponse) {
        return { success: true, data: cachedResponse };
      }
    }

    this.#activeFetch?.abort();
    this.#activeFetch = new AbortController();

    try {
      const response = await fetch(url, { signal: this.#activeFetch.signal });
      if (!response.ok) {
        return { success: false, status: response.status };
      }

      const text = await response.text();
      this.#cachedRecommendations[url] = text;
      return { success: true, data: text };
    } finally {
      this.#activeFetch = null;
    }
  }

  /**
   * Extracts this element's own markup from a Section Rendering API response, stripping
   * the `<div id="shopify-section-{sectionId}">` wrapper Shopify adds around it, if
   * present.
   * @param {string} html
   * @param {string} sectionId
   * @returns {string}
   */
  #extractSectionMarkup(html, sectionId) {
    const trimmed = html.trim();
    if (!trimmed) return '';

    const wrapper = new DOMParser().parseFromString(trimmed, 'text/html').getElementById(`shopify-section-${sectionId}`);

    return wrapper ? wrapper.innerHTML.trim() : trimmed;
  }

  /**
   * Handle errors in a consistent way, matching `<product-recommendations>`.
   * @param {Error} error
   */
  #handleError(error) {
    console.error('Cart recommendations error:', error.message);
    this.classList.add('hidden');
  }
}

if (!customElements.get('cart-recommendations')) {
  customElements.define('cart-recommendations', CartRecommendations);
}
