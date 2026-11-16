/*
 * Custom theme JavaScript.
 * Loaded on every page as a deferred classic script (see snippets/scripts.liquid),
 * so it runs after the DOM is parsed. Keep store-specific behaviour here rather than
 * editing the theme's own assets, so upstream Horizon updates merge cleanly.
 */

/*
 * Infinite Options (Shoppad) cleanup.
 *
 * The app injects `#infiniteoptions-container` into the product page even with its app
 * embed switched off, so it can't be turned off from the theme alone. The personalizer
 * options are now rendered by blocks/_personalizer-options.liquid, and two sets of option
 * UI on one product would be both confusing and ambiguous at add to cart, so the app's
 * container is removed as soon as it lands.
 *
 * custom.css hides it as well: the container is injected asynchronously, and CSS wins the
 * race that JS can only ever catch up with, so there is no flash of the app's UI.
 *
 * Remove this block once the app has been uninstalled.
 */
(() => {
  const SELECTOR = '#infiniteoptions-container, [id^="infiniteoptions-container"]';

  const strip = (root) => {
    for (const element of root.querySelectorAll(SELECTOR)) element.remove();
  };

  strip(document);

  // The container arrives after the app's script runs, and again after a variant change,
  // so watching is the only reliable way to catch every one of them.
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(SELECTOR)) node.remove();
        else if (node.firstElementChild) strip(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();

/*
 * Cart express buttons: Shop Pay only.
 *
 * Apple Pay and Google Pay in the cart open the wallet sheet straight away, so the buyer never
 * sees the checkout page or its pre-ticked "Email me with news and offers" box. After the cart
 * got express buttons (Oct 5 2026), new Apple Pay buyers getting subscribed fell from 84% to
 * about 30%. Shop Pay opens its own checkout, which shows the box, so it stays. Apple Pay and
 * Google Pay are still offered at the top of the checkout page.
 *
 * Shopify draws the wallets inside a closed shadow root and reads `wallet-configs` only when the
 * element connects: editing the attribute afterwards does nothing, and hiding a button with CSS
 * leaves its empty slot behind (custom.css still hides them as a fallback). So a cart element
 * that lists those wallets is swapped for a fresh one without them. morph.js keeps an existing
 * element across cart updates, but the drawer can insert a new one, hence the observer.
 */
(() => {
  const TAG = 'shopify-accelerated-checkout-cart';
  const DROP = new Set(['apple_pay', 'google_pay']);

  const filter = (element) => {
    let configs;
    try {
      configs = JSON.parse(element.getAttribute('wallet-configs') || '[]');
    } catch {
      return;
    }
    if (!Array.isArray(configs) || !configs.some((config) => DROP.has(config?.name))) return;

    const fresh = document.createElement(TAG);
    for (const { name, value } of element.attributes) fresh.setAttribute(name, value);
    fresh.setAttribute('wallet-configs', JSON.stringify(configs.filter((config) => !DROP.has(config?.name))));
    element.replaceWith(fresh);
  };

  for (const element of document.querySelectorAll(TAG)) filter(element);

  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.localName === TAG) filter(node);
        else if (node.firstElementChild) for (const element of node.querySelectorAll(TAG)) filter(element);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
