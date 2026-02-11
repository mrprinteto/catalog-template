function init(): void {
  const btn = document.getElementById('catalog-pdf-btn');
  if (!btn) return;

  const clientName = btn.dataset.client || 'catalogo';
  const body = document.body;

  btn.addEventListener('click', async () => {
    const target = document.querySelector('.max-w-7xl') as HTMLElement | null;
    if (!target) return;

    const originalText = btn.textContent;
    btn.toggleAttribute('disabled', true);
    btn.textContent = 'Generando…';
    btn.classList.add('opacity-60', 'cursor-not-allowed');

    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    try {
      // Dynamic imports: load only when user clicks (bundle-dynamic-imports pattern)
      const { default: html2canvas } = await import('html2canvas');
      const { jsPDF } = await import('jspdf');

      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff',
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const usableWidth = pageWidth - margin * 2;
      const usableHeight = pageHeight - margin * 2;

      const imgWidth = usableWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = margin;

      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= usableHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight + margin;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
        heightLeft -= usableHeight;
      }

      const fileName = `catalogo-${encodeURIComponent(clientName)}.pdf`;
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
