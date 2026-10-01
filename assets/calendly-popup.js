/**
 * Opens Calendly's popup scheduler (Calendly.initPopupWidget) from ordinary links.
 *
 * A page opts in with a config element, rendered by a custom-liquid block:
 *   <div data-calendly-popup="https://calendly.com/<account>/<event>" data-calendly-trigger="#book-a-meeting" hidden></div>
 * A click on any link whose href attribute equals the trigger then opens the popup instead of
 * following the link, so links in rich text (which cannot carry an onclick) work unchanged.
 * Calendly's widget files load on the first click only. If they fail to load, the booking page
 * opens directly instead.
 */

const WIDGET_SCRIPT = 'https://assets.calendly.com/assets/external/widget.js';
const WIDGET_STYLES = 'https://assets.calendly.com/assets/external/widget.css';

/** @type {Promise<void> | null} */
let widgetLoading = null;

/**
 * Loads Calendly's widget script and styles once.
 * @returns {Promise<void>}
 */
function loadWidget() {
  if ('Calendly' in window) return Promise.resolve();
  if (widgetLoading) return widgetLoading;

  widgetLoading = new Promise((resolve, reject) => {
    const styles = document.createElement('link');
    styles.rel = 'stylesheet';
    styles.href = WIDGET_STYLES;
    document.head.append(styles);

    const script = document.createElement('script');
    script.src = WIDGET_SCRIPT;
    script.async = true;
    script.addEventListener('load', () => ('Calendly' in window ? resolve() : reject(new Error('Calendly not found'))));
    script.addEventListener('error', () => reject(new Error('Calendly widget failed to load')));
    document.head.append(script);
  }).catch((error) => {
    widgetLoading = null;
    throw error;
  });

  return widgetLoading;
}

/**
 * Finds the booking URL configured for a link, if the link is a trigger.
 * @param {HTMLAnchorElement} link
 * @returns {string | null}
 */
function bookingUrlFor(link) {
  const href = link.getAttribute('href');
  if (!href) return null;

  for (const config of document.querySelectorAll('[data-calendly-popup][data-calendly-trigger]')) {
    if (!(config instanceof HTMLElement)) continue;
    if (config.dataset.calendlyTrigger === href && config.dataset.calendlyPopup) return config.dataset.calendlyPopup;
  }

  return null;
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (!(event.target instanceof Element)) return;

  const link = event.target.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return;

  const url = bookingUrlFor(link);
  if (!url) return;

  event.preventDefault();
  loadWidget()
    .then(() => {
      // @ts-ignore Calendly is a global from widget.js
      window.Calendly.initPopupWidget({ url });
    })
    .catch(() => {
      window.location.href = url;
    });
});
