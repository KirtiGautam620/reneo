/**
 * The add-to-cart gesture.
 *
 * Adding to a cart is the moment a browser becomes a buyer, and a silent
 * re-render throws that away — the count in the corner changes and nobody sees
 * it. So the product is given weight: a chip carrying its name and price lifts
 * off the button, arcs across the page and is caught by the cart, which
 * flinches under it.
 *
 * The arc is the point. A straight tween reads as a computer moving a rectangle
 * from A to B; a real object thrown across a room rises, then falls. The chip
 * follows two chained animations — a rise that eases out, then a drop that
 * eases in — so it decelerates at the apex the way a thrown thing does.
 *
 * Nothing here is decorative-only: the flight ends by telling the cart to
 * animate, which is what connects cause to effect.
 */

export const CART_RECEIVED_EVENT = 'reneo:cart-received';
/** The header marks its cart control with this so the chip knows where to land. */
export const CART_TARGET_ATTR = 'data-cart-target';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A CSS time resolves to seconds or milliseconds depending on how the browser
 * normalises it — `620ms` comes back as `.62s`. Reading it with a bare
 * parseFloat silently yields 0.62, collapsing the whole flight into a frame.
 */
function parseDuration(value: string, fallback: number): number {
  const raw = value.trim();
  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount)) return fallback;
  return raw.endsWith('ms') ? amount : amount * 1000;
}

function announceArrival(): void {
  window.dispatchEvent(new CustomEvent(CART_RECEIVED_EVENT));
}

export function flyToCart(origin: HTMLElement, label: string, price: string): void {
  if (typeof window === 'undefined') return;

  const target = document.querySelector<HTMLElement>(`[${CART_TARGET_ATTR}]`);

  /*
   * With reduced motion, or no cart on screen to fly to, the gesture collapses
   * to its meaning: the cart still reacts, it simply does not travel.
   */
  if (!target || prefersReducedMotion()) {
    announceArrival();
    return;
  }

  const from = origin.getBoundingClientRect();
  const to = target.getBoundingClientRect();

  const chip = document.createElement('div');
  chip.setAttribute('aria-hidden', 'true');
  chip.className = 'flying-chip';
  chip.innerHTML = `<span class="flying-chip__name"></span><span class="flying-chip__price"></span>`;
  // textContent, not innerHTML — a product name is seller-supplied text.
  chip.querySelector('.flying-chip__name')!.textContent = label;
  chip.querySelector('.flying-chip__price')!.textContent = price;

  chip.style.left = `${from.left}px`;
  chip.style.top = `${from.top}px`;
  chip.style.width = `${from.width}px`;
  chip.style.height = `${from.height}px`;
  document.body.appendChild(chip);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  // Rise before falling; taller for a longer throw, but capped.
  const apex = Math.min(160, Math.abs(dx) * 0.35 + 60);

  const styles = getComputedStyle(document.documentElement);
  const total = parseDuration(styles.getPropertyValue('--duration-flight'), 620);
  const rise = total * 0.45;
  const fall = total - rise;

  const lift = chip.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      {
        transform: `translate(${dx * 0.45}px, ${dy * 0.2 - apex}px) scale(0.72)`,
        opacity: 1,
      },
    ],
    { duration: rise, easing: 'cubic-bezier(0.16, 0.84, 0.44, 1)', fill: 'forwards' }
  );

  lift.onfinish = () => {
    const drop = chip.animate(
      [
        {
          transform: `translate(${dx * 0.45}px, ${dy * 0.2 - apex}px) scale(0.72)`,
          opacity: 1,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(0.18)`, opacity: 0.35 },
      ],
      // Accelerating into the cart, the mirror of the eased-out rise.
      { duration: fall, easing: 'cubic-bezier(0.55, 0, 0.85, 0.5)', fill: 'forwards' }
    );

    drop.onfinish = () => {
      chip.remove();
      // The cart reacts as the chip lands, not when the click happened.
      announceArrival();
    };
  };
}
