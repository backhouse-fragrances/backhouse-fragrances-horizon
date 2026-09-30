import { Component } from '@theme/component';

/**
 * The product add-ons block: puts the chosen add-on into the same add to cart request as
 * the product being viewed, as its own plain cart line.
 *
 * The dropdown is <personalizer-select>, whose native `<select>` has no `name` and no
 * `form` attribute, so on its own it submits nothing. Instead this listens for `formdata`,
 * which the browser fires on the product form each time Horizon's product-form.js builds
 * its `new FormData(form)`, and appends three entries: `items[0][id]`, `items[0][quantity]`
 * and `items[0][properties][<label>]`. Cart's /cart/add turns those into a second line,
 * separate from the product's own, that carries the line item property
 * `<label>: <this product's title>`.
 *
 * Append only, on purpose. Horizon reads `formData.get('id')` after the request and throws
 * "Form ID is required" without it, so the top level `id` and `quantity` are left exactly
 * as they were. Sending a top level `id` together with `items[]` is not in Shopify's Cart
 * API docs, but it is accepted and both are added (tested 2026-09-30).
 *
 * Two looks share this one script. The dropdown look has a "No thanks" row and a note under
 * the field. The boxed look has a `[data-addon-toggle]` checkbox instead: nothing is added
 * while it is unticked, the picture and price follow the chosen add-on, and picking one in
 * the dropdown ticks the box.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} [note] - Dropdown look: the line under the field naming the choice.
 * @property {HTMLImageElement} [thumb] - Boxed look: the picture of the chosen add-on.
 * @property {HTMLElement} [price] - Boxed look: the chosen add-on's price.
 *
 * @extends Component<Refs>
 */
export class ProductAddons extends Component {
  requiredRefs = [];

  /** @type {AbortController | undefined} */
  #abortController;

  connectedCallback() {
    super.connectedCallback();

    // Fresh each time: a section morph can disconnect and reconnect this element, and an
    // aborted controller can't be reused.
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    // `formdata` does not bubble, but a capture listener on the document still sees it,
    // and unlike a listener on the form it survives the product form being re-rendered.
    document.addEventListener('formdata', this.#handleFormData, { capture: true, signal });

    // Both the select and the checkbox fire `change` on a native element, and it bubbles.
    this.addEventListener('change', this.#handleChange, { signal });

    // A back/forward navigation can restore a choice the markup doesn't reflect.
    this.#render();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
  }

  /** The boxed look's checkbox, if this is the boxed look. */
  get #toggle() {
    const toggle = this.querySelector('[data-addon-toggle]');
    return toggle instanceof HTMLInputElement ? toggle : null;
  }

  /**
   * The row picked in the dropdown. The select sits inside <personalizer-select>, and refs
   * don't cross nested components, so it is looked up rather than declared as a ref.
   */
  get #selected() {
    return this.querySelector('select')?.selectedOptions[0];
  }

  /**
   * The add-on to send, or `null` for none: "No thanks" has no `data-variant-id`, and an
   * unticked box means the shopper isn't asking for the add-on whatever the dropdown shows.
   */
  get #chosen() {
    if (this.#toggle && !this.#toggle.checked) return null;
    return this.#selected?.dataset.variantId ? this.#selected : null;
  }

  /**
   * Appends the chosen add-on to this block's product form. Forms other than the one named
   * in `data-form-id` are left alone.
   * @param {FormDataEvent} event
   */
  #handleFormData = (event) => {
    // `getAttribute`, not `form.id`: the product form holds an `<input name="id">`, and a
    // named control shadows the property, so `form.id` is that input rather than the string.
    if (!(event.target instanceof HTMLFormElement) || event.target.getAttribute('id') !== this.dataset.formId) return;

    const variantId = this.#chosen?.dataset.variantId;
    const { formData } = event;
    if (!variantId || !formData.get('id')) return;

    formData.append('items[0][id]', variantId);
    formData.append('items[0][quantity]', String(formData.get('quantity') || 1));
    formData.append(`items[0][properties][${this.dataset.propertyName}]`, this.dataset.parentTitle ?? '');
  };

  /**
   * Picking a different add-on in the boxed look means the shopper wants it, so the box is
   * ticked for them. Unticking stays their call. A change to the box itself only needs
   * rendering.
   * @param {Event} event
   */
  #handleChange = (event) => {
    const toggle = this.#toggle;
    if (toggle && event.target instanceof HTMLSelectElement) toggle.checked = true;

    this.#render();
  };

  /** Brings the note (dropdown look) or the picture and price (boxed look) up to date. */
  #render() {
    const { note, thumb, price } = this.refs;

    if (note) {
      const chosen = this.#chosen;

      if (chosen) {
        note.textContent = `${chosen.dataset.title}, ${chosen.dataset.price}, ${this.dataset.note}`;
        note.hidden = false;
      } else {
        note.hidden = true;
        note.textContent = '';
      }
    }

    // These follow the dropdown, not the box: the picture shows what a tick would add.
    const selected = this.#selected;
    if (!selected) return;

    if (price && selected.dataset.price) price.textContent = `+${selected.dataset.price}`;

    if (thumb) {
      // `data-image-2x` reads as `dataset['image-2x']`: a dash before a digit isn't camel-cased.
      const { image, title = '' } = selected.dataset;
      const image2x = selected.dataset['image-2x'];

      thumb.hidden = !image;
      if (image) {
        thumb.src = image;
        thumb.srcset = image2x ? `${image} 1x, ${image2x} 2x` : '';
      }
      thumb.alt = title;
    }
  }
}

if (!customElements.get('product-addons')) {
  customElements.define('product-addons', ProductAddons);
}
