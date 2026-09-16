import { Component } from '@theme/component';

/**
 * A single-select dropdown for a personalizer option.
 *
 * The native `<select>` is the source of truth: it carries the `properties[...]` name and
 * the `form` attribute, so the value submits with add to cart whether or not this script
 * ever runs. The custom UI is a thin layer over it - every choice writes back to the
 * select and dispatches `change`, so anything listening to the form sees a normal event.
 *
 * @typedef {object} Refs
 * @property {HTMLSelectElement} native - The select that actually submits.
 * @property {HTMLButtonElement} trigger - The button that opens the list.
 * @property {HTMLElement} value - The trigger's text, showing the current choice.
 * @property {HTMLElement} menu - The listbox.
 * @property {HTMLElement[]} options - The listbox rows, in the select's option order.
 *
 * @extends Component<Refs>
 */
export class PersonalizerSelect extends Component {
  requiredRefs = ['native', 'trigger', 'value', 'menu'];

  /** Index of the row the keyboard is on while the list is open, or -1 for none. */
  #activeIndex = -1;

  /** @type {AbortController | undefined} */
  #abortController;

  connectedCallback() {
    super.connectedCallback();

    // A back/forward navigation can restore a selection the markup doesn't reflect.
    if (this.refs.native.value) this.#render(this.refs.native.value);

    // Fresh each time: a section morph can disconnect and reconnect this element, and an
    // aborted controller can't be reused.
    this.#abortController = new AbortController();
    document.addEventListener('pointerdown', this.#handleDocumentPointerDown, {
      signal: this.#abortController.signal,
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
  }

  get #isOpen() {
    return !this.refs.menu.hidden;
  }

  /** Rows, skipping the placeholder that sits at index 0 of the native select. */
  get #rows() {
    return this.refs.options ?? [];
  }

  /**
   * Closes the list when a press lands anywhere else, including another select.
   * A field rather than a method so it keeps `this` without rebinding - private methods
   * are read-only and can't be reassigned to a bound copy.
   * @param {PointerEvent} event
   */
  #handleDocumentPointerDown = (event) => {
    if (!this.#isOpen) return;
    if (event.target instanceof Node && this.contains(event.target)) return;
    this.close();
  };

  /** Opens or closes the list. Bound declaratively via `on:click`. */
  toggle() {
    this.#isOpen ? this.close() : this.open();
  }

  open() {
    // One list at a time, so two open menus can never overlap each other.
    for (const other of document.querySelectorAll('personalizer-select')) {
      if (other !== this && other instanceof PersonalizerSelect) other.close();
    }

    this.refs.menu.hidden = false;
    this.refs.trigger.setAttribute('aria-expanded', 'true');
    this.#setActive(this.#rows.findIndex((row) => row.getAttribute('aria-selected') === 'true'));
  }

  close() {
    if (!this.#isOpen) return;
    this.refs.menu.hidden = true;
    this.refs.trigger.setAttribute('aria-expanded', 'false');
    this.#setActive(-1);
  }

  /**
   * Commits a choice.
   * @param {number} index - Row index, matching the order the choices were rendered in.
   */
  choose(index) {
    const row = this.#rows[index];
    if (!row) return;

    const value = row.dataset.value ?? '';
    this.refs.native.value = value;
    this.refs.native.dispatchEvent(new Event('change', { bubbles: true }));

    this.#render(value);
    this.close();
    this.refs.trigger.focus();
  }

  /**
   * Keyboard handling on the trigger: the list is opened and walked from here, so focus
   * never has to move into it and back out again.
   * @param {KeyboardEvent} event
   */
  handleTriggerKeydown(event) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.#isOpen) return this.open();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.#setActive(this.#clamp(this.#activeIndex + step));
        break;
      }

      case 'Home':
        if (!this.#isOpen) return;
        event.preventDefault();
        this.#setActive(0);
        break;

      case 'End':
        if (!this.#isOpen) return;
        event.preventDefault();
        this.#setActive(this.#rows.length - 1);
        break;

      case 'Enter':
      case ' ':
        if (!this.#isOpen) return this.open();
        event.preventDefault();
        this.choose(this.#activeIndex);
        break;

      case 'Escape':
        if (!this.#isOpen) return;
        event.preventDefault();
        this.close();
        break;

      case 'Tab':
        this.close();
        break;
    }
  }

  /** @param {number} index */
  #clamp(index) {
    const count = this.#rows.length;
    if (!count) return -1;
    return (index + count) % count;
  }

  /** @param {number} index */
  #setActive(index) {
    this.#activeIndex = index;

    this.#rows.forEach((row, i) => row.toggleAttribute('data-active', i === index));

    const row = this.#rows[index];
    if (row) {
      this.refs.trigger.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    } else {
      this.refs.trigger.removeAttribute('aria-activedescendant');
    }
  }

  /**
   * Points the trigger and the listbox at the current value.
   * @param {string} value
   */
  #render(value) {
    const { value: label, native } = this.refs;

    // `data-chosen` is what tells CSS to stop styling the trigger as placeholder text.
    this.toggleAttribute('data-chosen', value !== '');
    label.textContent = value === '' ? native.options[0]?.text ?? '' : value;

    for (const row of this.#rows) {
      row.setAttribute('aria-selected', String(row.dataset.value === value && value !== ''));
    }
  }
}

if (!customElements.get('personalizer-select')) {
  customElements.define('personalizer-select', PersonalizerSelect);
}

/**
 * A checkbox list for a multiselect personalizer option.
 *
 * Checkboxes sharing one `properties[...]` name would overwrite each other - the cart
 * keeps a single value per key - so the boxes stay unnamed and a hidden input carries the
 * joined selection, which is also the form it takes on the order.
 *
 * @typedef {object} CheckboxRefs
 * @property {HTMLInputElement} value - The hidden input that submits.
 * @property {HTMLInputElement[]} boxes - The checkboxes.
 *
 * @extends Component<CheckboxRefs>
 */
export class PersonalizerCheckboxes extends Component {
  requiredRefs = ['value'];

  connectedCallback() {
    super.connectedCallback();
    this.sync();
  }

  /** Writes the checked choices into the hidden input. Bound via `on:change`. */
  sync() {
    const { value, boxes = [] } = this.refs;
    const chosen = boxes.filter((box) => box.checked);

    value.value = chosen.map((box) => box.value).join(', ');

    this.#validate(chosen.length > 0);
  }

  /**
   * Enforces "choose at least one" on a required group.
   *
   * The hidden input can't carry it - hidden inputs are barred from constraint validation
   * - and `required` on a checkbox means "tick this particular box". Marking the first box
   * invalid instead gives the browser something real to block submission on and to point
   * its message at, and the group's own wording comes from the block setting.
   *
   * @param {boolean} satisfied - Whether at least one choice is ticked.
   */
  #validate(satisfied) {
    if (!this.hasAttribute('data-required')) return;

    const first = this.refs.boxes?.[0];
    if (!first) return;

    first.setCustomValidity(satisfied ? '' : this.dataset.message || 'Please choose at least one option.');
  }
}

if (!customElements.get('personalizer-checkboxes')) {
  customElements.define('personalizer-checkboxes', PersonalizerCheckboxes);
}
