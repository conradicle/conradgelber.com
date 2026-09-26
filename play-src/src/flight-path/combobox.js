// A type-ahead text box following the ARIA combobox pattern (list
// autocomplete, manual selection): typing filters a listbox of
// suggestions, Down and Up move through it, Enter picks the highlighted
// one or submits what was typed, Escape closes the list (or clears the
// box when it is already closed). Focus stays in the text box throughout;
// the highlighted option is conveyed with aria-activedescendant.

export function createCombobox({ input, list, getSuggestions, onSubmit }) {
  let options = [];
  let active = -1;

  function isOpen() {
    return input.getAttribute('aria-expanded') === 'true';
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function render() {
    list.textContent = '';
    options.forEach((opt, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.textContent = opt.label;
      list.append(li);
    });
    if (options.length) {
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    } else {
      close();
    }
    if (active >= 0) {
      const el = list.children[active];
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function update() {
    options = input.value.trim() ? getSuggestions(input.value) : [];
    active = -1;
    render();
  }

  function move(step) {
    if (!isOpen()) {
      update();
      if (!options.length) return;
    }
    active = active < 0
      ? (step > 0 ? 0 : options.length - 1)
      : (active + step + options.length) % options.length;
    render();
  }

  function submit(option) {
    const text = option ? option.name : input.value;
    close();
    if (!text.trim()) return;
    input.value = '';
    onSubmit(text, option || null);
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown': move(1); break;
      case 'ArrowUp': move(-1); break;
      case 'Enter': submit(active >= 0 ? options[active] : null); break;
      case 'Escape':
        if (isOpen()) close();
        else input.value = '';
        break;
      case 'Tab': close(); return;
      default: return;
    }
    e.preventDefault();
  });
  input.addEventListener('blur', close);

  // Keep focus in the text box when an option is pressed.
  list.addEventListener('pointerdown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    submit(options[[...list.children].indexOf(li)]);
    input.focus();
  });

  return {
    submit: () => submit(active >= 0 ? options[active] : null),
    close,
  };
}
