/*
 * АвтоЖурнал — доступность фокуса.
 *
 * Помогает удерживать клавиатурный фокус внутри открытого диалога,
 * чтобы Tab и Shift+Tab не уходили на скрытый фон.
 *
 * Диалоги могут открываться друг над другом: например, подтверждение
 * удаления поверх формы заправки. Поэтому активный слой хранится в стеке,
 * а весь фон и нижние слои временно получают атрибут inert.
 */
(function () {
  'use strict';

  var FOCUSABLE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    'iframe',
    'object',
    'embed',
    '[contenteditable="true"]',
    '[tabindex]'
  ].join(',');

  var BACKGROUND_SELECTOR = '.app, .sheet, .modal-backdrop';
  var dialogStack = [];

  function isFocusable(node) {
    if (!node || typeof node.focus !== 'function') {
      return false;
    }
    if (node.disabled || node.hidden || node.inert) {
      return false;
    }
    if (node.tabIndex < 0) {
      return false;
    }
    if (node.closest('[hidden], [inert], [aria-hidden="true"]')) {
      return false;
    }
    if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) {
      return false;
    }
    if (typeof window.getComputedStyle === 'function') {
      var style = window.getComputedStyle(node);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        return false;
      }
    }
    return true;
  }

  function focusableElements(container) {
    if (!container) {
      return [];
    }
    return Array.prototype.filter.call(
      container.querySelectorAll(FOCUSABLE_SELECTOR),
      isFocusable
    );
  }

  function focusFirst(container, preferred) {
    if (!container) {
      return false;
    }

    var target = preferred &&
      container.contains(preferred) &&
      isFocusable(preferred)
      ? preferred
      : null;

    if (!target) {
      var items = focusableElements(container);
      target = items.length ? items[0] : null;
    }

    if (target) {
      target.focus();
      return document.activeElement === target;
    }
    return false;
  }

  function trapTab(container, event) {
    if (!container || !event || event.key !== 'Tab') {
      return false;
    }

    var items = focusableElements(container);
    if (!items.length) {
      event.preventDefault();
      return true;
    }

    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    var index = items.indexOf(active);
    var target = null;

    if (index === -1) {
      target = event.shiftKey ? last : first;
    } else if (event.shiftKey && index === 0) {
      target = last;
    } else if (!event.shiftKey && index === items.length - 1) {
      target = first;
    }

    if (!target) {
      return false;
    }

    event.preventDefault();
    target.focus();
    return true;
  }

  function restoreFocus(opener, fallback) {
    var target = isFocusable(opener) ? opener : null;

    if (!target && typeof fallback === 'function') {
      target = fallback();
      if (!isFocusable(target)) {
        target = null;
      }
    }

    if (!target) {
      return false;
    }

    target.focus();
    return document.activeElement === target;
  }

  function findDialogIndex(container) {
    for (var index = 0; index < dialogStack.length; index += 1) {
      if (dialogStack[index].container === container) {
        return index;
      }
    }
    return -1;
  }

  function topDialog() {
    return dialogStack.length ? dialogStack[dialogStack.length - 1].container : null;
  }

  function isDialogOpen(container) {
    return findDialogIndex(container) !== -1;
  }

  function setInert(node, value) {
    if (!node) {
      return;
    }
    if ('inert' in node) {
      node.inert = Boolean(value);
    } else if (value) {
      node.setAttribute('inert', '');
    } else {
      node.removeAttribute('inert');
    }
  }

  function syncBackground() {
    var top = topDialog();
    var nodes = document.querySelectorAll(BACKGROUND_SELECTOR);

    Array.prototype.forEach.call(nodes, function (node) {
      var isActiveLayer = top && (node === top || node.contains(top));
      setInert(node, Boolean(top) && !isActiveLayer);
    });
  }

  function syncBodyLock() {
    if (!document.body) {
      return;
    }

    var sheetOpen = false;
    var modalOpen = false;

    dialogStack.forEach(function (entry) {
      if (entry.container.classList.contains('sheet')) {
        sheetOpen = true;
      }
      if (entry.container.classList.contains('modal-backdrop')) {
        modalOpen = true;
      }
    });

    document.body.classList.toggle('sheet-open', sheetOpen);
    document.body.classList.toggle('modal-open', modalOpen);
  }

  function syncDocumentState() {
    syncBackground();
    syncBodyLock();
  }

  function defaultFallback() {
    var top = topDialog();
    var items;

    if (top) {
      items = focusableElements(top);
      if (items.length) {
        return items[0];
      }
    }

    var activeNav = document.querySelector('.nav-item.is-active');
    if (isFocusable(activeNav)) {
      return activeNav;
    }

    var app = document.querySelector('.app');
    items = focusableElements(app);
    return items.length ? items[0] : null;
  }

  function openDialog(container, options) {
    if (!container) {
      return false;
    }

    var settings = options || {};
    var index = findDialogIndex(container);
    var entry;

    if (index !== -1) {
      entry = dialogStack[index];
      dialogStack.splice(index, 1);
    } else {
      var active = document.activeElement;
      var opener = settings.opener !== undefined ? settings.opener : active;

      if (opener === document.body || (opener && container.contains(opener))) {
        opener = null;
      }

      entry = {
        container: container,
        opener: opener || null,
        fallback: settings.fallback || null
      };
    }

    dialogStack.push(entry);
    syncDocumentState();

    var initialFocus = settings.initialFocus;
    if (typeof initialFocus === 'function') {
      initialFocus = initialFocus();
    }
    focusFirst(container, initialFocus);
    return true;
  }

  function closeDialog(container, options) {
    var settings = options || {};
    var index = findDialogIndex(container);
    if (index === -1) {
      return false;
    }

    var entry = dialogStack[index];
    var wasTop = index === dialogStack.length - 1;
    dialogStack.splice(index, 1);
    syncDocumentState();

    if (!wasTop || settings.restore === false) {
      return true;
    }

    var focusTarget = settings.focusTarget;
    var fallback = settings.fallback || entry.fallback || defaultFallback;

    function applyRestore() {
      var top = topDialog();
      if (top && top.contains(document.activeElement) && isFocusable(document.activeElement)) {
        return;
      }
      if (typeof focusTarget === 'function') {
        focusTarget = focusTarget();
      }
      restoreFocus(focusTarget || entry.opener, fallback);
    }

    if (settings.deferRestore) {
      window.setTimeout(applyRestore, 0);
    } else {
      applyRestore();
    }

    return true;
  }

  window.MuranoFocus = {
    isFocusable: isFocusable,
    focusableElements: focusableElements,
    focusFirst: focusFirst,
    trapTab: trapTab,
    restoreFocus: restoreFocus,
    openDialog: openDialog,
    closeDialog: closeDialog,
    topDialog: topDialog,
    isDialogOpen: isDialogOpen
  };
})();
