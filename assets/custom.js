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
