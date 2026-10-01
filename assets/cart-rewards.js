import { StandardEvents, CartLinesUpdateEvent } from '@shopify/events';
import { ThemeEvents } from '@theme/events';
import { fetchConfig } from '@theme/utilities';

/**
 * @typedef {object} RewardTier
 * @property {string} handle - The cart_reward entry handle. Also the value of the `_cart_reward` line property.
 * @property {number} threshold - The qualifying subtotal that unlocks the gift, in cents.
 * @property {number} variantId - The variant added as the gift.
 */

/**
 * @typedef {object} CartLine
 * @property {string} key
 * @property {number} quantity
 * @property {number} final_line_price
 * @property {Record<string, string> | null} [properties]
 */

/**
 * @typedef {object} AjaxCart
 * @property {number} item_count
 * @property {CartLine[]} items
 */

/** The hidden line item property that marks a line as an auto-added reward gift. */
const GIFT_PROPERTY = '_cart_reward';

/** Identifies the events this module dispatches, so it does not react to its own cart changes. */
const SOURCE = 'cart-rewards';

const DISMISSED_PREFIX = 'cart-rewards:dismissed:';

/** More cart changes than this inside the window means something is fighting the script, so it stops. */
const MUTATION_LIMIT = 6;
const MUTATION_WINDOW_MS = 30000;

/**
 * Adds and removes the free gifts of the cart rewards tiers.
 *
 * The bar itself is rendered by `snippets/cart-rewards.liquid`, so it is already correct after any
 * section render. This only keeps the cart lines in step with it: once the qualifying subtotal
 * (every line except the gifts, see the snippet) reaches a Free gift tier, the gift variant is added
 * with the property `_cart_reward` = the tier handle; below the threshold the gift line is removed,
 * and a gift line is never allowed to hold more than one unit.
 *
 * It runs on load, after every `cart:lines-update` (add to cart, quantity, remove) and when the
 * cart section is restored from the back/forward cache. After changing the cart it dispatches its
 * own `cart:lines-update` carrying the freshly rendered cart sections, so the cart items
 * components morph the drawer and cart page, and the cart icon and recommendations follow.
 *
 * A gift the shopper removes while still eligible is remembered in sessionStorage by tier handle
 * and not added again in that session. An empty cart clears that memory.
 */
class CartRewards {
  /** @type {RewardTier[]} */
  #tiers;

  #syncing = false;

  /** Set when a cart change arrives during a sync, which then runs once more. */
  #queued = false;

  #halted = false;

  /** Tiers whose gift line was in the cart after the previous sync. A gift that vanishes from here was removed by the shopper. */
  #knownGifts = new Set();

  /** Tiers whose gift could not be added. Not retried until the next page load. */
  #failed = new Set();

  /** Mirrors sessionStorage, which can throw (private windows, blocked storage). */
  #dismissed = new Set();

  /** @type {number[]} */
  #mutationTimes = [];

  /**
   * @param {{ cartCount?: number, tiers?: RewardTier[] }} config
   */
  constructor(config) {
    this.#tiers = config.tiers ?? [];

    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartUpdate);
    // Back and forward: the restored page shows whatever cart it held when the shopper left.
    document.addEventListener(ThemeEvents.cartSectionRestored, this.#handleRestore);
    window.addEventListener('pageshow', this.#handlePageShow);

    if (config.cartCount && config.cartCount > 0) this.sync();
  }

  /**
   * @param {import('@shopify/events').CartLinesUpdateEvent} event
   */
  #handleCartUpdate = (event) => {
    event.promise
      ?.then(({ detail }) => {
        if (detail?.source === SOURCE) return;

        this.sync();
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[cart-rewards] Event promise rejected:', error);
      });
  };

  #handleRestore = () => {
    this.sync();
  };

  /**
   * Covers a restore on a page without a cart items component (cart type "page" outside /cart),
   * where `cart-section:restored` never fires. A second call in the same restore just queues.
   * @param {PageTransitionEvent} event
   */
  #handlePageShow = (event) => {
    if (event.persisted) this.sync();
  };

  /**
   * Reconciles the gift lines with the cart. Calls made while a sync is running queue exactly one more run.
   */
  async sync() {
    if (this.#halted) return;

    if (this.#syncing) {
      this.#queued = true;
      return;
    }

    this.#syncing = true;

    try {
      do {
        this.#queued = false;
        await this.#reconcile();
      } while (this.#queued && !this.#halted);
    } catch (error) {
      console.warn('[cart-rewards] Sync failed:', error);
    } finally {
      this.#syncing = false;
    }
  }

  async #reconcile() {
    const cart = await this.#fetchCart();
    if (!cart) return;

    if (cart.item_count === 0) {
      this.#knownGifts.clear();
      this.#clearDismissed();
      return;
    }

    const giftLines = cart.items.filter((line) => line.properties?.[GIFT_PROPERTY]);
    const qualifying = cart.items.reduce(
      (sum, line) => (line.properties?.[GIFT_PROPERTY] ? sum : sum + line.final_line_price),
      0
    );
    const tierHandles = new Set(this.#tiers.map((tier) => tier.handle));

    /** @type {Array<() => Promise<void>>} */
    const operations = [];

    // A gift whose tier no longer exists (entry made Draft or past its end date) would otherwise
    // stay in the cart at full price.
    for (const line of giftLines) {
      if (!tierHandles.has(String(line.properties?.[GIFT_PROPERTY]))) {
        operations.push(() => this.#changeLine(line.key, 0, 'remove'));
      }
    }

    for (const tier of this.#tiers) {
      const lines = giftLines.filter((line) => line.properties?.[GIFT_PROPERTY] === tier.handle);

      if (qualifying < tier.threshold) {
        this.#knownGifts.delete(tier.handle);
        for (const line of lines) operations.push(() => this.#changeLine(line.key, 0, 'remove'));
        continue;
      }

      const [giftLine, ...duplicates] = lines;

      if (!giftLine) {
        if (this.#knownGifts.has(tier.handle)) {
          // It was here after the last sync and is gone while the cart still qualifies: the shopper removed it.
          this.#knownGifts.delete(tier.handle);
          this.#dismiss(tier.handle);
        } else if (!this.#isDismissed(tier.handle) && !this.#failed.has(tier.handle)) {
          operations.push(() => this.#addGift(tier));
        }
        continue;
      }

      this.#knownGifts.add(tier.handle);

      if (giftLine.quantity !== 1) operations.push(() => this.#changeLine(giftLine.key, 1, 'update'));
      for (const line of duplicates) operations.push(() => this.#changeLine(line.key, 0, 'remove'));
    }

    for (const operation of operations) {
      if (!this.#allowMutation()) return;

      try {
        await operation();
      } catch (error) {
        console.warn('[cart-rewards] Cart change failed:', error);
      }
    }
  }

  /**
   * Adds the gift variant and tells the rest of the theme.
   * @param {RewardTier} tier
   */
  async #addGift(tier) {
    const body = JSON.stringify({
      items: [{ id: tier.variantId, quantity: 1, properties: { [GIFT_PROPERTY]: tier.handle } }],
      ...this.#sectionParams(),
    });

    const response = await fetch(Theme.routes.cart_add_url, fetchConfig('json', { body }));

    if (!response.ok) {
      // 422 is Shopify refusing the line (sold out, not purchasable). Retrying cannot help.
      // Anything else (rate limit, network) is worth another try on the next cart change.
      if (response.status === 422) this.#failed.add(tier.handle);
      throw new Error(`Adding the gift failed with status ${response.status}`);
    }

    const result = await response.json();
    const cart = await this.#fetchCart();
    const addedLine = result.items?.[0];
    if (!cart || !addedLine) throw new Error('Cart missing after adding the gift');

    this.#knownGifts.add(tier.handle);
    this.#announce('update', [{ id: addedLine.key, quantity: 1 }], cart, result.sections);
  }

  /**
   * Sets the quantity of a cart line. Removing is quantity 0.
   * @param {string} key - The cart line key.
   * @param {number} quantity
   * @param {'update' | 'remove'} action
   */
  async #changeLine(key, quantity, action) {
    const body = JSON.stringify({ id: key, quantity, ...this.#sectionParams() });
    const response = await fetch(Theme.routes.cart_change_url, fetchConfig('json', { body }));
    if (!response.ok) throw new Error(`Changing the gift line failed with status ${response.status}`);

    const cart = await response.json();

    this.#announce(action, [{ id: key, quantity }], cart, cart.sections);
  }

  /**
   * Asks the cart endpoints to render every cart section on the page, as the theme's own cart
   * changes do, so one request updates the drawer and the cart page.
   * @returns {{ sections?: string, sections_url?: string }}
   */
  #sectionParams() {
    const sectionIds = new Set();

    for (const component of document.querySelectorAll('cart-items-component')) {
      if (component instanceof HTMLElement && component.dataset.sectionId) sectionIds.add(component.dataset.sectionId);
    }

    if (sectionIds.size === 0) return {};

    return { sections: Array.from(sectionIds).join(','), sections_url: window.location.pathname };
  }

  /**
   * Dispatches the cart update the theme's components listen to. The promise is already settled,
   * so the cart items components morph the supplied sections, the cart icon takes the new count
   * and the recommendations reload. The action is never 'add': that would auto-open the drawer
   * for a gift the shopper did not add.
   * @param {'update' | 'remove'} action
   * @param {Array<{ id: string, quantity: number }>} lines
   * @param {AjaxCart} cart
   * @param {Record<string, string> | undefined} sections
   */
  #announce(action, lines, cart, sections) {
    const deferred = CartLinesUpdateEvent.createPromise();

    document.dispatchEvent(
      new CartLinesUpdateEvent({
        action,
        context: 'cart',
        lines,
        promise: deferred.promise,
      })
    );

    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        sections,
        items: cart.items,
        itemCount: cart.item_count,
        source: SOURCE,
        didError: false,
      },
    });
  }

  /**
   * @returns {Promise<AjaxCart | null>} Null when the request fails, so the caller leaves the cart alone.
   */
  async #fetchCart() {
    try {
      const response = await fetch(`${Theme.routes.cart_url}.js`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;

      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Circuit breaker. Every cart change is counted; a burst means something else keeps undoing the
   * script (another app, a discount rule), and looping would hammer the cart.
   * @returns {boolean}
   */
  #allowMutation() {
    const now = Date.now();
    this.#mutationTimes = this.#mutationTimes.filter((time) => now - time < MUTATION_WINDOW_MS);

    if (this.#mutationTimes.length >= MUTATION_LIMIT) {
      this.#halted = true;
      console.warn('[cart-rewards] Too many cart changes in a short time, stopping until the page is reloaded.');
      return false;
    }

    this.#mutationTimes.push(now);
    return true;
  }

  /** @param {string} handle */
  #isDismissed(handle) {
    if (this.#dismissed.has(handle)) return true;

    try {
      return sessionStorage.getItem(DISMISSED_PREFIX + handle) === '1';
    } catch {
      return false;
    }
  }

  /** @param {string} handle */
  #dismiss(handle) {
    this.#dismissed.add(handle);

    try {
      sessionStorage.setItem(DISMISSED_PREFIX + handle, '1');
    } catch {
      // The in-memory copy still holds for this page view.
    }
  }

  #clearDismissed() {
    this.#dismissed.clear();

    try {
      for (const tier of this.#tiers) sessionStorage.removeItem(DISMISSED_PREFIX + tier.handle);
    } catch {
      // Nothing was stored.
    }
  }
}

function init() {
  const configElement = document.getElementById('cart-rewards-config');
  if (!configElement?.textContent) return;

  try {
    new CartRewards(JSON.parse(configElement.textContent));
  } catch (error) {
    console.warn('[cart-rewards] Invalid config:', error);
  }
}

init();
