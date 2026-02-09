type ProductRow = {
  id: string;
  name: string;
  price: number;
  qty: number;
  countEl: HTMLInputElement;
  minusBtn: HTMLButtonElement;
};

const STORAGE_KEY = 'presupuesto-state';

function formatCurrency(value: number): string {
  return `€${value.toFixed(2)}`;
}

function loadQuantities(): Map<string, number> {
  try {
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
    return new Map();
  }
}

function init(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-product-id]'));
  const itemsContainer = document.getElementById('presupuesto-items');
  const totalEl = document.getElementById('presupuesto-total');
  if (!itemsContainer || !totalEl) return;

  const state = new Map<string, ProductRow>();

  function saveState(): void {
    const snapshot: Record<string, number> = {};
    for (const row of state.values()) {
      if (row.qty > 0) snapshot[row.id] = row.qty;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn('No se pudo guardar el presupuesto', err);
    }
  }

  function render(): void {
    const rows = Array.from(state.values()).filter((r) => r.qty > 0);

    itemsContainer.innerHTML = '';

    if (rows.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Sin productos añadidos.';
      p.className = 'text-slate-500';
      itemsContainer.appendChild(p);
      totalEl.textContent = formatCurrency(0);
      return;
    }

    let total = 0;

    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'flex items-center justify-between gap-3';

      const left = document.createElement('div');
      left.className = 'flex flex-col';

      const name = document.createElement('span');
      name.className = 'font-semibold text-slate-900';
      name.textContent = row.name;

      const meta = document.createElement('span');
      meta.className = 'text-sm text-slate-500';
      meta.textContent = `${row.qty} × ${formatCurrency(row.price)}`;

      left.appendChild(name);
      left.appendChild(meta);

      const right = document.createElement('span');
      right.className = 'font-semibold text-slate-900';
      const subtotal = row.qty * row.price;
      right.textContent = formatCurrency(subtotal);

      line.appendChild(left);
      line.appendChild(right);
      itemsContainer.appendChild(line);

      total += subtotal;
    }

    totalEl.textContent = formatCurrency(total);
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
    const name = card.dataset.productName ?? 'Producto';
    const price = Number(card.dataset.productPrice ?? 0) || 0;
    const countEl = card.querySelector<HTMLInputElement>('[data-role="count"]');
    const minusBtn = card.querySelector<HTMLButtonElement>('[data-action="decrement"]');
    const plusBtn = card.querySelector<HTMLButtonElement>('[data-action="increment"]');
    if (!countEl || !minusBtn || !plusBtn) continue;

    const row: ProductRow = {
      id,
      name,
      price,
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
