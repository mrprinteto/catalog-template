/**
 * Tour guiado sencillo para explicar las secciones del catálogo
 */

interface TourStep {
  selector: string;
  text: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="1"]',
    text: 'Este es tu catálogo. Nadie lo puede ver y lo hemos hecho exclusivamente para ti',
    position: 'bottom',
  },
  {
    selector: '[data-tour="2"]',
    text: 'Estos son los productos que hemos preparado para tu marca. ¡Pero podemos crear cualquier idea que tengas en mente!',
    position: 'bottom',
  },
  {
    selector: '[data-tour="3"]',
    text: 'Añade aquí los productos que quieras a tu presupuesto. A partir de 25 unidades, aplicamos un descuento por volumen.',
    position: 'bottom',
  },
  {
    selector: '[data-tour="4"]',
    text: 'Aquí tienes tu presupuesto, <strong>¡pero no pagas nada!</strong> <br><br> Al <span class="bg-indigo-500 text-xs text-white px-2 py-1 rounded-full "><i class="fas fa-paper-plane"></i> Confirmar presupuesto</span> te escribiremos para confirmar el pedido y realizar el pago. Si tienes alguna duda escríbeme por <span class="bg-green-500 text-xs text-white px-2 py-1 rounded-full "><i class="fab fa-whatsapp"></i> WhatsApp</span>',
    position: 'left',
  }
];

const TOUR_STORAGE_KEY = 'catalog_tour_completed';

class CatalogTour {
  private currentStep = 0;
  private overlay: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private highlightedEl: HTMLElement | null = null;
  private currentPosition: TourStep['position'] = 'bottom';
  private scrollHandler: (() => void) | null = null;

  constructor() {
    if (this.shouldShowTour()) {
      // Pequeño delay para que la página cargue completamente
      setTimeout(() => this.start(), 800);
    }
  }

  private shouldShowTour(): boolean {
    return !localStorage.getItem(TOUR_STORAGE_KEY);
  }

  private markTourCompleted(): void {
    localStorage.setItem(TOUR_STORAGE_KEY, 'true');
  }

  start(): void {
    this.currentStep = 0;
    this.createOverlay();
    this.showStep(this.currentStep);
  }

  private createOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'tour-overlay';
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.nextStep();
      }
    });
    document.body.appendChild(this.overlay);
  }

  private removeOverlay(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private showStep(stepIndex: number): void {
    const step = TOUR_STEPS[stepIndex];
    if (!step) {
      this.end();
      return;
    }

    const element = document.querySelector<HTMLElement>(step.selector);
    if (!element) {
      // Si no encuentra el elemento, salta al siguiente
      this.nextStep();
      return;
    }

    // Quitar highlight anterior
    if (this.highlightedEl) {
      this.highlightedEl.classList.remove('tour-highlight');
    }

    // Scroll al elemento
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Aplicar highlight
    setTimeout(() => {
      element.classList.add('tour-highlight');
      this.highlightedEl = element;
      this.createTooltip(step, element, stepIndex);
    }, 400);
  }

  private createTooltip(step: TourStep, element: HTMLElement, stepIndex: number): void {
    // Remover tooltip anterior
    if (this.tooltip) {
      this.tooltip.remove();
    }

    const rect = element.getBoundingClientRect();
    const tooltip = document.createElement('div');
    tooltip.className = `tour-tooltip arrow-${this.getArrowPosition(step.position)}`;

    // Contenido del tooltip
    tooltip.innerHTML = `
      <div class="tour-tooltip-step">${stepIndex + 1}</div>
      <p class="tour-tooltip-text">${step.text}</p>
      <div class="tour-tooltip-actions">
        <button class="tour-tooltip-btn tour-tooltip-btn-skip" data-action="skip">
          Saltar tour
        </button>
        <div class="tour-dots">
          ${TOUR_STEPS.map((_, i) => `<span class="tour-dot ${i === stepIndex ? 'active' : ''}" data-step="${i}"></span>`).join('')}
        </div>
        <button class="tour-tooltip-btn tour-tooltip-btn-next" data-action="next">
          ${stepIndex === TOUR_STEPS.length - 1 ? "¡Listo!" : 'Siguiente'}
        </button>
      </div>
    `;

    document.body.appendChild(tooltip);
    this.tooltip = tooltip;
    this.currentPosition = step.position;

    // Posicionar tooltip
    this.positionTooltip(tooltip, rect, step.position);

    // Reposicionar en scroll
    this.removeScrollHandler();
    this.scrollHandler = () => {
      if (this.tooltip && this.highlightedEl) {
        const updatedRect = this.highlightedEl.getBoundingClientRect();
        this.positionTooltip(this.tooltip, updatedRect, this.currentPosition);
      }
    };
    window.addEventListener('scroll', this.scrollHandler, { passive: true });

    // Event listeners
    tooltip.querySelector('[data-action="skip"]')?.addEventListener('click', () => this.end());
    tooltip.querySelector('[data-action="next"]')?.addEventListener('click', () => this.nextStep());
    
    // Click en dots para navegar a cualquier paso
    tooltip.querySelectorAll('.tour-dot[data-step]').forEach((dot) => {
      dot.addEventListener('click', () => {
        const stepNum = parseInt(dot.getAttribute('data-step') || '0', 10);
        this.goToStep(stepNum);
      });
    });
  }

  private removeScrollHandler(): void {
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
  }

  private getArrowPosition(position: string): string {
    switch (position) {
      case 'top':
        return 'bottom';
      case 'bottom':
        return 'top';
      case 'left':
        return 'right';
      case 'right':
        return 'left';
      default:
        return 'top';
    }
  }

  private positionTooltip(tooltip: HTMLElement, rect: DOMRect, position: string): void {
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 20;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let resolvedPosition = position;

    // Si indica bottom pero no cabe abajo, mejor flip a top
    if (position === 'bottom' && rect.bottom + margin + tooltipRect.height > viewportHeight - 10) {
      resolvedPosition = 'top';
    }
    // Si indica top pero no cabe arriba, flip a bottom
    if (position === 'top' && rect.top - margin - tooltipRect.height < 10) {
      resolvedPosition = 'bottom';
    }
    // Si indica left pero no cabe a la izquierda, flip a bottom
    if (position === 'left' && rect.left - margin - tooltipRect.width < 10) {
      resolvedPosition = 'bottom';
    }
    // Si indica right pero no cabe a la derecha, flip a bottom
    if (position === 'right' && rect.right + margin + tooltipRect.width > viewportWidth - 10) {
      resolvedPosition = 'bottom';
    }

    let top = 0;
    let left = 0;

    switch (resolvedPosition) {
      case 'top':
        top = rect.top - tooltipRect.height - margin;
        left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        break;
      case 'bottom':
        top = rect.bottom + margin;
        left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tooltipRect.height / 2;
        left = rect.left - tooltipRect.width - margin;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - tooltipRect.height / 2;
        left = rect.right + margin;
        break;
    }

    // Ajustar horizontalmente si se sale de la pantalla
    if (left < 10) left = 10;
    if (left + tooltipRect.width > viewportWidth - 10) {
      left = viewportWidth - tooltipRect.width - 10;
    }

    // Actualizar clase de la flecha si cambió la posición por desbordamiento
    const arrowClass = `arrow-${this.getArrowPosition(resolvedPosition)}`;
    tooltip.className = tooltip.className.replace(/arrow-\w+/, arrowClass);

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  private goToStep(stepIndex: number): void {
    if (stepIndex >= 0 && stepIndex < TOUR_STEPS.length) {
      this.currentStep = stepIndex;
      this.showStep(this.currentStep);
    }
  }

  private nextStep(): void {
    this.currentStep++;
    if (this.currentStep >= TOUR_STEPS.length) {
      this.end();
    } else {
      this.showStep(this.currentStep);
    }
  }

  private end(): void {
    // Quitar scroll handler
    this.removeScrollHandler();

    // Quitar highlight
    if (this.highlightedEl) {
      this.highlightedEl.classList.remove('tour-highlight');
      this.highlightedEl = null;
    }

    // Quitar tooltip
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }

    // Quitar overlay
    this.removeOverlay();

    // Marcar como completado
    this.markTourCompleted();
  }
}

// Iniciar el tour cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CatalogTour());
} else {
  new CatalogTour();
}
