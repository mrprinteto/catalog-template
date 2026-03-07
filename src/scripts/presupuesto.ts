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
  clientEmail: string;
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

  function getCompanyInfo(): { companyName: string; companySlug: string; clientEmail: string } {
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
    const clientEmail =
      presupuestoSection?.getAttribute('data-company-email') ||
      submitButton?.getAttribute('data-company-email') ||
      '';

    return { companyName, companySlug, clientEmail };
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
    const { companyName, companySlug, clientEmail } = getCompanyInfo();

    return {
      companyName,
      companySlug,
      clientEmail,
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
  const notificationModalEl = document.getElementById('catalog-notification-modal');
  const notificationTitleEl = document.getElementById('catalog-notification-title');
  const notificationMessageEl = document.getElementById('catalog-notification-message');
  const notificationIconEl = document.getElementById('catalog-notification-icon');
  const notificationCloseBtn = document.getElementById('catalog-notification-close') as HTMLButtonElement | null;
  const notificationCancelBtn = document.getElementById('catalog-notification-cancel') as HTMLButtonElement | null;
  const confirmationSubmitBtn = document.getElementById('catalog-confirmation-submit') as HTMLButtonElement | null;
  const confirmationContentEl = document.getElementById('catalog-confirmation-content');
  const confirmationSummaryEl = document.getElementById('catalog-confirmation-summary');
  const confirmationClientEmailEl = document.getElementById('catalog-confirmation-client-email');

  if (!submitBtn || !notificationModalEl || !notificationTitleEl || !notificationMessageEl || !notificationIconEl || !notificationCloseBtn || !notificationCancelBtn || !confirmationSubmitBtn || !confirmationContentEl || !confirmationSummaryEl || !confirmationClientEmailEl) {
    return;
  }

  const submitBtnNode = submitBtn as HTMLButtonElement;
  const notificationModalNode = notificationModalEl;
  const notificationTitleNode = notificationTitleEl;
  const notificationMessageNode = notificationMessageEl;
  const notificationIconNode = notificationIconEl;
  const notificationCloseBtnNode = notificationCloseBtn;
  const notificationCancelBtnNode = notificationCancelBtn;
  const confirmationSubmitBtnNode = confirmationSubmitBtn;
  const confirmationContentNode = confirmationContentEl;
  const confirmationSummaryNode = confirmationSummaryEl;
  const confirmationClientEmailNode = confirmationClientEmailEl;
  let pendingPayload: PresupuestoPayload | null = null;

  const fallbackMessage =
    'Para este pedido necesitamos que nos escribas un email a <a class="font-bold text-indigo-500" href="mailto:info@mrprinteto.com">info@mrprinteto.com</a> con los detalles de lo que quieres solicitar.';

  function setSubmitLoadingState(isLoading: boolean): void {
    submitBtnNode.disabled = isLoading;
    submitBtnNode.textContent = isLoading ? 'Enviando...' : 'Confirmar presupuesto';
    confirmationSubmitBtnNode.disabled = isLoading;
    confirmationSubmitBtnNode.textContent = isLoading ? 'Enviando...' : 'Confirmar';
  }

  function setNotificationIcon(kind: 'success' | 'warning' | 'error' | 'confirm'): void {
    notificationIconNode.classList.remove(
      'bg-emerald-100',
      'text-emerald-700',
      'bg-rose-100',
      'text-rose-700',
      'bg-yellow-100',
      'text-yellow-700',
      'bg-indigo-100',
      'text-indigo-700'
    );
    notificationIconNode.innerHTML = '';

    const icon = document.createElement('i');

    if (kind === 'success') {
      icon.className = 'fa-solid fa-check';
      notificationIconNode.classList.add('bg-emerald-100', 'text-emerald-700');
    } else if (kind === 'warning') {
      icon.className = 'fa-solid fa-triangle-exclamation';
      notificationIconNode.classList.add('bg-yellow-100', 'text-yellow-700');
    } else if (kind === 'error') {
      icon.className = 'fa-solid fa-triangle-exclamation';
      notificationIconNode.classList.add('bg-rose-100', 'text-rose-700');
    } else {
      icon.className = 'fa-solid fa-paper-plane';
      notificationIconNode.classList.add('bg-indigo-100', 'text-indigo-700');
    }

    notificationIconNode.appendChild(icon);
  }

  function closeNotificationModal(): void {
    pendingPayload = null;
    notificationModalNode.classList.add('hidden');
    notificationModalNode.classList.remove('flex');
  }

  function openNotificationModal(title: string, message: string, kind: 'success' | 'warning' | 'error'): void {
    notificationTitleNode.textContent = title;
    notificationMessageNode.innerHTML = message;
    notificationMessageNode.classList.remove('hidden');
    confirmationContentNode.classList.add('hidden');
    notificationCloseBtnNode.classList.remove('hidden');
    notificationCancelBtnNode.classList.add('hidden');
    confirmationSubmitBtnNode.classList.add('hidden');
    setNotificationIcon(kind);

    notificationModalNode.classList.remove('hidden');
    notificationModalNode.classList.add('flex');
  }

  function renderConfirmationSummary(payload: PresupuestoPayload): void {
    confirmationSummaryNode.innerHTML = '';

    for (const item of payload.items) {
      const row = document.createElement('div');
      row.className = 'flex items-start justify-between gap-3';

      const left = document.createElement('div');
      left.className = 'min-w-0 flex-1';

      const right = document.createElement('div');
      right.className = 'shrink-0 text-right';

      const name = document.createElement('p');
      name.className = 'font-semibold text-slate-900';
      name.textContent = item.name;

      const meta = document.createElement('p');
      meta.className = 'text-xs text-slate-500';
      meta.textContent = `${item.qty} × ${formatCurrency(item.unitPrice)}`;

      const subtotal = document.createElement('p');
      subtotal.className = 'font-semibold text-slate-800';
      subtotal.textContent = formatCurrency(item.subtotal);

      left.appendChild(name);
      left.appendChild(meta);
      right.appendChild(subtotal);
      row.appendChild(left);
      row.appendChild(right);
      confirmationSummaryNode.appendChild(row);
    }

    const divider = document.createElement('div');
    divider.className = 'my-2 border-t border-dashed border-slate-300';
    confirmationSummaryNode.appendChild(divider);

    const subtotalRow = document.createElement('div');
    subtotalRow.className = 'flex items-center justify-between text-xs text-slate-600';
    subtotalRow.innerHTML = `<span>Subtotal</span><span>${formatCurrency(payload.subtotal)}</span>`;
    confirmationSummaryNode.appendChild(subtotalRow);

    const discountRow = document.createElement('div');
    discountRow.className = 'flex items-center justify-between text-xs text-emerald-700';
    discountRow.innerHTML = `<span>Descuento</span><span>-${formatCurrency(payload.discount)}</span>`;
    confirmationSummaryNode.appendChild(discountRow);

    const totalRow = document.createElement('div');
    totalRow.className = 'mt-1 flex items-center justify-between font-semibold text-slate-900';
    totalRow.innerHTML = `<span>Total</span><span>${formatCurrency(payload.total)}</span>`;
    confirmationSummaryNode.appendChild(totalRow);
  }

  function openConfirmationModal(payload: PresupuestoPayload): void {
    pendingPayload = payload;

    notificationTitleNode.textContent = 'Confirma tu pedido';
    notificationMessageNode.classList.add('hidden');
    notificationMessageNode.textContent = '';
    confirmationContentNode.classList.remove('hidden');
    notificationCloseBtnNode.classList.add('hidden');
    notificationCancelBtnNode.classList.remove('hidden');
    confirmationSubmitBtnNode.classList.remove('hidden');
    setNotificationIcon('confirm');

    confirmationClientEmailNode.textContent = payload.clientEmail || 'tu email de empresa';
    renderConfirmationSummary(payload);

    notificationModalNode.classList.remove('hidden');
    notificationModalNode.classList.add('flex');
  }

  async function submitPedido(payload: PresupuestoPayload): Promise<void> {
    setSubmitLoadingState(true);

    try {
      const response = await fetch('/api/pedido', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        openNotificationModal(
          'Acceso no válido',
          'Tu sesión ha caducado. Recarga la página e introduce de nuevo la clave de acceso.',
          'error'
        );
        return;
      }

      if (response.ok && data?.success) {
        openNotificationModal(
          'Pedido confirmado',
          `Tu pedido se ha enviado correctamente. Hemos enviado un email a ${payload.clientEmail || 'tu contacto'} y también hemos avisado a nuestro equipo para ponernos en contacto contigo y acordar la producción y el pago.`,
          'success'
        );
        pendingPayload = null;
      } else {
        openNotificationModal('Necesitamos más datos', fallbackMessage, 'warning');
      }
    } catch {
      openNotificationModal('Necesitamos más datos', fallbackMessage, 'error');
    } finally {
      setSubmitLoadingState(false);
    }
  }

  submitBtnNode.addEventListener('click', () => {
    const payload = buildPresupuestoPayload();
    if (!payload) {
      openNotificationModal('Añade productos', 'Selecciona al menos un producto para solicitar el pedido.', 'warning');
      return;
    }

    openConfirmationModal(payload);
  });

  confirmationSubmitBtnNode.addEventListener('click', () => {
    if (!pendingPayload) return;
    void submitPedido(pendingPayload);
  });

  notificationCloseBtnNode.addEventListener('click', closeNotificationModal);
  notificationCancelBtnNode.addEventListener('click', closeNotificationModal);
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
