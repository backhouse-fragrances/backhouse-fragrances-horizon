/**
 * Bottom-anchored sticky for the product details column.
 *
 * Horizon anchors a sticky column to the top (base.css: `.sticky-content--desktop { top:
 * var(--sticky-header-offset, 0) }`). That is right for a short column, but this store's
 * details column runs well past the viewport - description plus four accordions - so a top
 * anchor pins it the moment its top clears the header and the lower half can never be
 * reached, because you cannot scroll inside a sticky element.
 *
 * The live storefront solves it by writing a negative `top` from script: measured on
 * Prestige at 1440x900, a 1955px column holds at top: -1075px, i.e. viewport - gap -
 * height. The column then scrolls through completely and holds with its bottom in view.
 *
 * CSS alone can't express this - `top` has no way to reference the element's own height,
 * and `bottom` sticks on the way up rather than the way down - and a stylesheet override
 * would have to outrank Horizon's own
 * `.shopify-section:has(.sticky-add-to-cart__bar--top) :is(.product-details.sticky-content--desktop, ...)`
 * at (0,4,0). So the offset is written inline, as live does. When the column fits the
 * viewport the inline value is removed, handing `top` back to Horizon's rules - including
 * the offset that tucks the column under the sticky add-to-cart bar.
 */

const SELECTOR = '.product-details.sticky-content--desktop';

/** Gap left below the column when it holds, matching live's 20px. */
const GAP = 20;

/** Horizon only sticks the details column from this width up. */
const DESKTOP = window.matchMedia('(min-width: 750px)');

/** @param {HTMLElement} element */
function sync(element) {
  const overflow = element.offsetHeight + GAP - window.innerHeight;

  if (!DESKTOP.matches || overflow <= 0) {
    element.style.removeProperty('top');
    return;
  }

  element.style.setProperty('top', `${-Math.round(overflow)}px`);
}

const observer = new ResizeObserver((entries) => {
  for (const entry of entries) sync(/** @type {HTMLElement} */ (entry.target));
});

const tracked = new WeakSet();

function scan() {
  for (const element of document.querySelectorAll(SELECTOR)) {
    if (!(element instanceof HTMLElement)) continue;
    sync(element);
    if (tracked.has(element)) continue;
    tracked.add(element);
    // The column's height changes whenever an accordion opens or a variant swaps copy.
    observer.observe(element);
  }
}

scan();
document.addEventListener('DOMContentLoaded', scan);
window.addEventListener('resize', scan);
DESKTOP.addEventListener('change', scan);
// Section rendering (theme editor, variant swaps) replaces the column wholesale.
document.addEventListener('shopify:section:load', scan);
document.addEventListener('shopify:block:select', scan);
