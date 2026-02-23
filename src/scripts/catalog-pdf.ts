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

const LAST_PRESUPUESTO_HTML_KEY = 'last-presupuesto-html';

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

function buildPresupuestoHtmlDocument(targetHtml: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Presupuesto</title>
  <style>
    #pdf-render-root {
      color-scheme: light;
      margin: 0;
      background: #ffffff;
      color: #0f172a;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      padding: 20px;
      width: 820px;
      max-width: 820px;
    }

    #pdf-render-root,
    #pdf-render-root * {
      box-sizing: border-box;
    }

    #pdf-render-root #presupuesto {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid #cbd5e1;
      background: #f1f4fc;
      padding: 20px;
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.06);
      width: 760px;
      max-width: 100%;
      margin: 0 auto;
    }

    #pdf-render-root .hidden {
      display: none !important;
    }

    #pdf-render-root #presupuesto-items {
      max-height: none !important;
      overflow: visible !important;
      padding-right: 0 !important;
      max-width: 680px;
      margin: 0 auto;
    }

    #pdf-render-root #presupuesto-footer {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: 680px;
      margin: 20px auto 0 auto;
    }

  </style>
</head>
<body>
  ${targetHtml}

  <div id="presupuesto-footer" class="mt-8 text-center text-slate-600 text-sm">
    <p>Gracias por confiar en MrPrinteto.</p>
    <p>Visita nuestra página web <a href="https://mrprinteto.com" class="text-indigo-500">https://mrprinteto.com</a> para más información.</p>
  </div>
</body>
</html>`;
}

function savePresupuestoHtmlSnapshot(html: string): void {
  try {
    localStorage.setItem(LAST_PRESUPUESTO_HTML_KEY, html);
  } catch {
  }
}

async function renderHtmlToPdf(pdf: any, htmlDocument: string): Promise<void> {
  const wrapper = document.createElement('div');
  wrapper.id = 'pdf-render-root';
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-99999px';
  wrapper.style.top = '0';
  wrapper.style.width = '820px';
  wrapper.style.background = '#fff';

  const parser = new DOMParser();
  const parsed = parser.parseFromString(htmlDocument, 'text/html');

  const headStyles = Array.from(parsed.head.querySelectorAll('style, link[rel="stylesheet"]'));
  for (const node of headStyles) {
    wrapper.appendChild(node.cloneNode(true));
  }

  const bodyChildren = Array.from(parsed.body.children);
  for (const node of bodyChildren) {
    wrapper.appendChild(node.cloneNode(true));
  }

  document.body.appendChild(wrapper);

  try {
    const html2canvasModule = await import('html2canvas');
    const html2canvasFn = (html2canvasModule as any).default ?? html2canvasModule;
    const canvas = await html2canvasFn(wrapper, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    const imageData = canvas.toDataURL('image/png');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const usableWidth = pageWidth - margin * 2;
    const imageHeight = (canvas.height * usableWidth) / canvas.width;

    let remainingHeight = imageHeight;
    let sourceY = 0;

    while (remainingHeight > 0) {
      if (sourceY > 0) {
        pdf.addPage();
      }

      const renderHeight = Math.min(pageHeight - margin * 2, remainingHeight);
      const sourceHeightPx = (renderHeight * canvas.width) / usableWidth;

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = Math.max(1, Math.floor(sourceHeightPx));

      const pageCtx = pageCanvas.getContext('2d');
      if (!pageCtx) break;

      pageCtx.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        pageCanvas.height,
        0,
        0,
        canvas.width,
        pageCanvas.height
      );

      const pageData = pageCanvas.toDataURL('image/png');
      pdf.addImage(pageData, 'PNG', margin, margin, usableWidth, renderHeight, undefined, 'FAST');

      sourceY += pageCanvas.height;
      remainingHeight -= renderHeight;
    }
  } finally {
    wrapper.remove();
  }
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

      const maybePayload = (window as WindowWithPresupuesto).getPresupuestoPayload?.() ?? null;
      const clientSlug = maybePayload?.companySlug || btn.dataset.client || 'cliente';
      const fileName = `presupuesto-${normalizeFilePart(clientSlug)}.pdf`;
      const presupuestoHtml = buildPresupuestoHtmlDocument(target.outerHTML);
      savePresupuestoHtmlSnapshot(presupuestoHtml);

      await renderHtmlToPdf(pdf, presupuestoHtml);

      if (pdf.getNumberOfPages() === 0) {
        const pageWidth = pdf.internal.pageSize.getWidth();
        const margin = 12;
        const maxWidth = pageWidth - margin * 2;
        let y = margin;

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

        const text = (target.innerText || '').trim() || 'Sin productos añadidos.';
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        addWrappedLine(pdf, text, margin, y, maxWidth, 5);
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
