type PdfPresupuestoItem = {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
};

type PdfPresupuestoPayload = {
  companyName: string;
  companySlug: string;
  items: PdfPresupuestoItem[];
  subtotal: number;
  discount: number;
  total: number;
};

type JsPdfConstructor = new (orientation: 'p' | 'l', unit: 'mm', format: 'a4') => any;

type WindowWithPresupuesto = Window & {
  getPresupuestoPayload?: () => PdfPresupuestoPayload | null;
};

function formatCurrency(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

function normalizeFilePart(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'cliente';
}

function addWrappedLine(pdf: any, text: string, x: number, y: number, maxWidth: number, lineHeight = 6): number {
  const lines = pdf.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    pdf.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

function init(): void {
  const btn = document.getElementById('catalog-pdf-btn') as HTMLButtonElement | null;
  if (!btn) return;

  const body = document.body;

  btn.addEventListener('click', async () => {
    const target = document.getElementById('presupuesto') as HTMLElement | null;
    if (!target) {
      alert('No se encontró el bloque de presupuesto.');
      return;
    }

    const originalText = btn.textContent;
    btn.toggleAttribute('disabled', true);
    btn.textContent = 'Generando…';
    btn.classList.add('opacity-60', 'cursor-not-allowed');

    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    try {
      const jspdfModule = await import('jspdf');
      const JsPdfCtor: JsPdfConstructor | undefined =
        (jspdfModule as any).jsPDF || (jspdfModule as any).default?.jsPDF || (jspdfModule as any).default;

      if (!JsPdfCtor) {
        throw new Error('No se pudo cargar jsPDF');
      }

      const pdf = new JsPdfCtor('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const maxWidth = pageWidth - margin * 2;
      let y = margin;

      const maybePayload = (window as WindowWithPresupuesto).getPresupuestoPayload?.() ?? null;
      const clientSlug = maybePayload?.companySlug || btn.dataset.client || 'cliente';
      const fileName = `presupuesto-${normalizeFilePart(clientSlug)}.pdf`;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.text('Presupuesto', margin, y);
      y += 8;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      const now = new Date();
      y = addWrappedLine(pdf, `Fecha: ${now.toLocaleDateString('es-ES')}`, margin, y, maxWidth, 5);

      if (maybePayload?.companyName) {
        y = addWrappedLine(pdf, `Cliente: ${maybePayload.companyName}`, margin, y, maxWidth, 5);
      }

      y += 2;
      pdf.setDrawColor(210, 214, 220);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 6;

      if (maybePayload && maybePayload.items.length > 0) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.text('Detalle', margin, y);
        y += 6;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);

        for (const item of maybePayload.items) {
          if (y > pageHeight - 24) {
            pdf.addPage();
            y = margin;
          }

          y = addWrappedLine(pdf, `${item.name} · ${item.qty} × ${formatCurrency(item.unitPrice)}`, margin, y, maxWidth - 34, 5);
          pdf.text(formatCurrency(item.subtotal), pageWidth - margin, y - 5, { align: 'right' });
          y += 1;
        }

        y += 3;
        pdf.line(margin, y, pageWidth - margin, y);
        y += 6;

        pdf.setFont('helvetica', 'normal');
        pdf.text(`Subtotal: ${formatCurrency(maybePayload.subtotal)}`, margin, y);
        y += 6;
        pdf.text(`Descuento: -${formatCurrency(maybePayload.discount)}`, margin, y);
        y += 7;

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.text(`TOTAL: ${formatCurrency(maybePayload.total)}`, margin, y);
      } else {
        const text = (target.innerText || '').trim() || 'Sin productos añadidos.';
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        y = addWrappedLine(pdf, text, margin, y, maxWidth, 5);
      }

      pdf.save(fileName);
    } catch (err) {
      console.error('Error generando PDF', err);
      alert('No se pudo generar el PDF. Intenta nuevamente.');
    } finally {
      body.style.overflow = previousOverflow;
      btn.toggleAttribute('disabled', false);
      btn.textContent = originalText;
      btn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
