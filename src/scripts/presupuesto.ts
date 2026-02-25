type ProductRow = {
  id: string;
  code: string;
  customized: boolean;
  name: string;
  priceBase: number;
  priceX25: number;
  priceX100: number;
  pricex250: number;
  qty: number;
  countEl: HTMLInputElement;
  minusBtn: HTMLButtonElement;
};

type PresupuestoItem = {
  id: string;
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
  baseUnitPrice: number;
  subtotal: number;
};

type PresupuestoPayload = {
  companyName: string;
  companySlug: string;
  items: PresupuestoItem[];
  subtotal: number;
  discount: number;
  total: number;
};

// Schema versioning for localStorage (client-localstorage-schema pattern)
const STORAGE_VERSION = 1;
const STORAGE_KEY = 'presupuesto-state';
const STORAGE_VERSION_KEY = 'presupuesto-version';

function formatCurrency(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

function loadQuantities(): Map<string, number> {
  try {
    // Check schema version and clear if outdated
    const storedVersion = localStorage.getItem(STORAGE_VERSION_KEY);
    const version = Number(storedVersion) || 0;
    
    if (version !== STORAGE_VERSION) {
      console.info(`Clearing old presupuesto schema (v${version} → v${STORAGE_VERSION})`);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION));
      return new Map();
    }
    
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, number>;
    return new Map(
      Object.entries(parsed)
        .filter(([, qty]) => Number.isFinite(qty) && qty > 0)
        .map(([id, qty]) => [id, Math.floor(qty)])
    );
  } catch (err) {
    console.warn('No se pudo leer el presupuesto almacenado', err);
    localStorage.removeItem(STORAGE_KEY);
    return new Map();
  }
}

function init(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-product-id]'));
  const itemsContainer = document.getElementById('presupuesto-items');
  const totalEl = document.getElementById('presupuesto-total');
  const savingsEl = document.getElementById('presupuesto-savings');
  const savingsRow = document.getElementById('presupuesto-savings-row');
  if (!itemsContainer || !totalEl) return;
  const itemsContainerEl = itemsContainer;
  const totalElEl = totalEl;

  const state = new Map<string, ProductRow>();

  function saveState(): void {
    const snapshot: Record<string, number> = {};
    for (const row of state.values()) {
      if (row.qty > 0) snapshot[row.id] = row.qty;
    }
    try {
      localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn('No se pudo guardar el presupuesto', err);
    }
  }

  function getUnitPrice(row: ProductRow, qty: number): number {
    if (qty >= 250 && row.pricex250 > 0) return row.pricex250;
    if (qty >= 100 && row.priceX100 > 0) return row.priceX100;
    if (qty >= 25 && row.priceX25 > 0) return row.priceX25;
    return row.priceBase;
  }

  function getSelectedRows(): ProductRow[] {
    return Array.from(state.values()).filter((r) => r.qty > 0);
  }

  function getCompanyInfo(): { companyName: string; companySlug: string } {
    const presupuestoSection = document.getElementById('presupuesto');
    const submitButton = document.getElementById('catalog-submit-btn');

    const companyName =
      presupuestoSection?.getAttribute('data-company-name') ||
      submitButton?.getAttribute('data-company-name') ||
      'Cliente';
    const companySlug =
      presupuestoSection?.getAttribute('data-company-slug') ||
      submitButton?.getAttribute('data-company-slug') ||
      '';

    return { companyName, companySlug };
  }

  function buildPresupuestoPayload(): PresupuestoPayload | null {
    const rows = getSelectedRows();
    if (rows.length === 0) return null;

    let total = 0;
    let subtotal = 0;

    const items: PresupuestoItem[] = rows.map((row) => {
      const unitPrice = getUnitPrice(row, row.qty);
      const lineSubtotal = row.qty * unitPrice;
      const lineBaseSubtotal = row.qty * row.priceBase;

      total += lineSubtotal;
      subtotal += lineBaseSubtotal;

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        qty: row.qty,
        unitPrice,
        baseUnitPrice: row.priceBase,
        subtotal: lineSubtotal,
      };
    });

    const discount = Math.max(0, subtotal - total);
    const { companyName, companySlug } = getCompanyInfo();

    return {
      companyName,
      companySlug,
      items,
      subtotal,
      discount,
      total,
    };
  }

  function render(): void {
    const rows = getSelectedRows();

    itemsContainerEl.innerHTML = '';

    if (rows.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Sin productos añadidos.';
      p.className = 'text-slate-500';
      itemsContainerEl.appendChild(p);
      totalElEl.textContent = formatCurrency(0);
      if (savingsRow) savingsRow.classList.add('hidden');
      return;
    }

    let total = 0;
    let totalSavings = 0;

    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'flex items-start justify-between gap-3';

      const left = document.createElement('div');
      left.className = 'min-w-0 flex-1 flex flex-col';

      const right = document.createElement('div');
      right.className = 'flex shrink-0 flex-col items-end';

      const rightTop = document.createElement('div');
      rightTop.className = 'flex items-center gap-1';

      const nameRow = document.createElement('div');
      nameRow.className = 'flex items-baseline gap-2';

      const name = document.createElement('span');
      name.className = 'font-semibold text-slate-900';
      name.textContent = row.name;
      nameRow.appendChild(name);

      if (row.customized) {
        const customizableIcon = document.createElement('i');
        customizableIcon.className = 'fa fa-pen-ruler text-[10px] text-indigo-500';
        customizableIcon.setAttribute('aria-hidden', 'true');
        nameRow.appendChild(customizableIcon);
      }

      if (row.code) {
        const code = document.createElement('span');
        code.className = 'font-light text-xs text-slate-400';
        code.textContent = row.code;
        rightTop.appendChild(code);
      }

      if (rightTop.childElementCount > 0) {
        right.appendChild(rightTop);
      }

      const meta = document.createElement('span');
      meta.className = 'text-sm text-slate-500';
      const unitPrice = getUnitPrice(row, row.qty);
      meta.textContent = `${row.qty} × `;
      
      if (unitPrice === row.priceBase) {
        // Sin descuento: mostrar solo el precio
        const price = document.createElement('span');
        price.className = 'text-slate-500';
        price.textContent = formatCurrency(unitPrice);
        meta.appendChild(price);
      } else {
        // Con descuento: mostrar precio tachado y nuevo precio
        const basePrice = document.createElement('span');
        basePrice.className = 'line-through text-slate-400 mr-2';
        basePrice.textContent = formatCurrency(row.priceBase);
        const appliedPrice = document.createElement('span');
        appliedPrice.className = 'text-slate-500';
        appliedPrice.textContent = formatCurrency(unitPrice);
        meta.appendChild(basePrice);
        meta.appendChild(appliedPrice);
      }

      left.appendChild(nameRow);
      left.appendChild(meta);

      const subtotalEl = document.createElement('span');
      subtotalEl.className = 'font-semibold text-slate-900';
      const subtotal = row.qty * unitPrice;
      subtotalEl.textContent = formatCurrency(subtotal);
      right.appendChild(subtotalEl);

      line.appendChild(left);
      line.appendChild(right);
      itemsContainerEl.appendChild(line);

      total += subtotal;
      const baseSubtotal = row.qty * row.priceBase;
      totalSavings += Math.max(0, baseSubtotal - subtotal);
    }

    totalElEl.textContent = formatCurrency(total);
    if (savingsEl && savingsRow) {
      savingsEl.textContent = `-${formatCurrency(totalSavings)}`;
      if (totalSavings > 0) {
        savingsRow.classList.remove('hidden');
      } else {
        savingsRow.classList.add('hidden');
      }
    }
  }

  function updateRow(id: string, delta: number, persist = true): void {
    const row = state.get(id);
    if (!row) return;

    row.qty = Math.max(0, row.qty + delta);
    row.countEl.value = String(row.qty);
    row.minusBtn.disabled = row.qty === 0;
    render();
    if (persist) saveState();
  }

  function setRow(id: string, value: number, persist = true): void {
    const row = state.get(id);
    if (!row) return;

    const qty = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    row.qty = qty;
    row.countEl.value = String(qty);
    row.minusBtn.disabled = row.qty === 0;
    render();
    if (persist) saveState();
  }

  const stored = loadQuantities();

  for (const card of cards) {
    const id = card.dataset.productId ?? '';
    if (!id) continue;
    const code = card.dataset.productCode ?? '';
    const customized = card.dataset.productCustomized === 'true';
    const name = card.dataset.productName ?? 'Producto';
    const priceBase = Number(card.dataset.productPrice ?? 0) || 0;
    const priceX25 = Number(card.dataset.productPriceX25 ?? 0) || 0;
    const priceX100 = Number(card.dataset.productPriceX100 ?? 0) || 0;
    const pricex250 = Number(card.dataset.productPriceX250 ?? 0) || 0;
    const countEl = card.querySelector<HTMLInputElement>('[data-role="count"]');
    const minusBtn = card.querySelector<HTMLButtonElement>('[data-action="decrement"]');
    const plusBtn = card.querySelector<HTMLButtonElement>('[data-action="increment"]');
    if (!countEl || !minusBtn || !plusBtn) continue;

    const row: ProductRow = {
      id,
      code,
      customized,
      name,
      priceBase,
      priceX25,
      priceX100,
      pricex250,
      qty: 0,
      countEl,
      minusBtn,
    };
    state.set(id, row);

    minusBtn.disabled = true;

    minusBtn.addEventListener('click', () => updateRow(id, -1));
    plusBtn.addEventListener('click', () => updateRow(id, 1));
    countEl.addEventListener('input', () => {
      const parsed = Number(countEl.value);
      setRow(id, parsed);
    });
    countEl.addEventListener('blur', () => {
      // Normaliza para evitar negativos o decimales tras perder foco
      setRow(id, Number(countEl.value));
    });

    if (stored.has(id)) {
      setRow(id, stored.get(id) ?? 0, false);
    }
  }

  render();
  saveState();

  (window as any).getPresupuestoPayload = buildPresupuestoPayload;

  const submitBtn = document.getElementById('catalog-submit-btn');
  const modalEl = document.getElementById('catalog-submit-modal');
  const keyInput = document.getElementById('catalog-submit-key') as HTMLInputElement | null;
  const modalErrorEl = document.getElementById('catalog-submit-modal-error');
  const cancelBtn = document.getElementById('catalog-submit-cancel') as HTMLButtonElement | null;
  const confirmBtn = document.getElementById('catalog-submit-confirm') as HTMLButtonElement | null;
  const notificationModalEl = document.getElementById('catalog-notification-modal');
  const notificationTitleEl = document.getElementById('catalog-notification-title');
  const notificationMessageEl = document.getElementById('catalog-notification-message');
  const notificationIconEl = document.getElementById('catalog-notification-icon');
  const notificationCloseBtn = document.getElementById('catalog-notification-close') as HTMLButtonElement | null;

  if (!submitBtn || !modalEl || !keyInput || !modalErrorEl || !cancelBtn || !confirmBtn || !notificationModalEl || !notificationTitleEl || !notificationMessageEl || !notificationIconEl || !notificationCloseBtn) {
    return;
  }

  const modalElNode = modalEl;
  const keyInputNode = keyInput;
  const modalErrorElNode = modalErrorEl;
  const confirmBtnNode = confirmBtn;
  const notificationModalNode = notificationModalEl;
  const notificationTitleNode = notificationTitleEl;
  const notificationMessageNode = notificationMessageEl;
  const notificationIconNode = notificationIconEl;
  const notificationCloseBtnNode = notificationCloseBtn;

  const fallbackMessage =
    'Para este pedido necesitamos que nos escribas un email a <a class="font-bold text-indigo-500" href="mailto:info@mrprinteto.com">info@mrprinteto.com</a> con los detalles de lo que quieres solicitar.';

  function closeNotificationModal(): void {
    notificationModalNode.classList.add('hidden');
    notificationModalNode.classList.remove('flex');
  }

  function openNotificationModal(title: string, message: string, kind: 'success' | 'warning' | 'error'): void {
    notificationTitleNode.textContent = title;
    notificationMessageNode.innerHTML = message;

    notificationIconNode.classList.remove('bg-emerald-100', 'text-emerald-700', 'bg-rose-100', 'text-rose-700', 'bg-yellow-100', 'text-yellow-700');
    notificationIconNode.innerHTML = '';

    const icon = document.createElement('i');
    icon.className = kind === 'success' ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation';

    // Successo: verde; Warning: naranja; Error: rojo
    if (kind === 'success') {
      notificationIconNode.classList.add('bg-emerald-100', 'text-emerald-700');
    } else if (kind === 'warning') {
      notificationIconNode.classList.add('bg-yellow-100', 'text-yellow-700');
    } else {
      notificationIconNode.classList.add('bg-rose-100', 'text-rose-700');
    }

    notificationIconNode.appendChild(icon);
    notificationModalNode.classList.remove('hidden');
    notificationModalNode.classList.add('flex');
  }

  function setModalError(message: string): void {
    if (!message) {
      modalErrorElNode.textContent = '';
      modalErrorElNode.classList.add('hidden');
      return;
    }
    modalErrorElNode.textContent = message;
    modalErrorElNode.classList.remove('hidden');
  }

  function openModal(): void {
    setModalError('');
    keyInputNode.value = '';
    modalElNode.classList.remove('hidden');
    modalElNode.classList.add('flex');
    window.setTimeout(() => keyInputNode.focus(), 0);
  }

  function closeModal(): void {
    modalElNode.classList.add('hidden');
    modalElNode.classList.remove('flex');
    setModalError('');
  }

  async function submitPedido(): Promise<void> {
    const payload = buildPresupuestoPayload();
    if (!payload) {
      setModalError('Añade al menos un producto para solicitar el pedido.');
      return;
    }

    const key = keyInputNode.value.trim();
    if (!key) {
      setModalError('Debes introducir una clave.');
      return;
    }

    confirmBtnNode.disabled = true;
    confirmBtnNode.textContent = 'Validando...';

    try {
      const response = await fetch('/api/pedido', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
          presupuesto: payload,
        }),
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (response.status === 401 || data?.code === 'INVALID_KEY') {
        setModalError('La clave no es correcta.');
        return;
      }

      closeModal();
      if (response.ok && data?.success) {
        openNotificationModal('Nos ponemos con ello!', 'Tu pedido se ha realizado correctamente. Nos pondremos en contacto contigo pronto.', 'success');
      } else {
        openNotificationModal('Necesitamos más datos', fallbackMessage, 'warning');
      }
    } catch {
      closeModal();
      openNotificationModal('Necesitamos más datos', fallbackMessage, 'error');
    } finally {
      confirmBtnNode.disabled = false;
      confirmBtnNode.textContent = 'Confirmar pedido';
    }
  }

  submitBtn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);

  modalElNode.addEventListener('click', (event) => {
    if (event.target === modalElNode) {
      closeModal();
    }
  });

  keyInputNode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitPedido();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  });

  confirmBtnNode.addEventListener('click', () => {
    void submitPedido();
  });

  notificationCloseBtnNode.addEventListener('click', closeNotificationModal);
  notificationModalNode.addEventListener('click', (event) => {
    if (event.target === notificationModalNode) {
      closeNotificationModal();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
