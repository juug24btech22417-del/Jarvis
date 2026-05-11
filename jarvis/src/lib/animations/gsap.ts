// GSAP Animation Utilities for JARVIS
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Register plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

// Panel entrance animation
export const animatePanelOpen = (element: HTMLElement | null, direction: 'left' | 'right' | 'top' | 'bottom' = 'right') => {
  if (!element) return;

  const fromX = direction === 'left' ? -400 : direction === 'right' ? 400 : 0;
  const fromY = direction === 'top' ? -400 : direction === 'bottom' ? 400 : 0;

  gsap.fromTo(element,
    { opacity: 0, x: fromX, y: fromY, scale: 0.95 },
    {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      duration: 0.5,
      ease: 'back.out(1.2)',
      clearProps: 'transform'
    }
  );
};

// Panel exit animation
export const animatePanelClose = (element: HTMLElement | null, direction: 'left' | 'right' | 'top' | 'bottom' = 'right', onComplete?: () => void) => {
  if (!element) return;

  const toX = direction === 'left' ? -400 : direction === 'right' ? 400 : 0;
  const toY = direction === 'top' ? -400 : direction === 'bottom' ? 400 : 0;

  gsap.to(element, {
    opacity: 0,
    x: toX,
    y: toY,
    scale: 0.95,
    duration: 0.3,
    ease: 'power2.in',
    onComplete
  });
};

// Staggered list items
export const animateStagger = (elements: HTMLElement[] | NodeListOf<Element>, staggerAmount = 0.05) => {
  gsap.fromTo(elements,
    { opacity: 0, y: 20, scale: 0.95 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.4,
      stagger: staggerAmount,
      ease: 'power2.out',
      clearProps: 'transform'
    }
  );
};

// Message appear animation
export const animateMessageAppear = (element: HTMLElement | null, isFromMe = false) => {
  if (!element) return;

  gsap.fromTo(element,
    {
      opacity: 0,
      x: isFromMe ? 50 : -50,
      scale: 0.9
    },
    {
      opacity: 1,
      x: 0,
      scale: 1,
      duration: 0.4,
      ease: 'back.out(1.5)'
    }
  );
};

// Pulse animation for reactor/core elements
export const createPulseAnimation = (element: HTMLElement | null, color: string = '#00d4ff') => {
  if (!element) return null;

  return gsap.to(element, {
    boxShadow: `0 0 30px ${color}, 0 0 60px ${color}40`,
    scale: 1.05,
    duration: 1.5,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut'
  });
};

// Hover scale effect
export const addHoverScale = (element: HTMLElement | null, scale = 1.05) => {
  if (!element) return;

  element.addEventListener('mouseenter', () => {
    gsap.to(element, { scale, duration: 0.2, ease: 'power2.out' });
  });

  element.addEventListener('mouseleave', () => {
    gsap.to(element, { scale: 1, duration: 0.2, ease: 'power2.out' });
  });
};

// Text typing animation
export const animateTyping = (element: HTMLElement | null, text: string, speed = 0.02) => {
  if (!element) return;

  const chars = text.split('');
  element.textContent = '';

  const tl = gsap.timeline();

  chars.forEach((char) => {
    tl.to({}, {
      duration: speed,
      onComplete: () => {
        element.textContent += char;
      }
    });
  });

  return tl;
};

// Arc reactor energy burst
export const createEnergyBurst = (element: HTMLElement | null) => {
  if (!element) return;

  const tl = gsap.timeline();

  tl.to(element, {
    scale: 1.2,
    filter: 'brightness(2)',
    duration: 0.1,
    ease: 'power2.out'
  })
    .to(element, {
      scale: 1,
      filter: 'brightness(1)',
      duration: 0.3,
      ease: 'elastic.out(1, 0.3)'
    });

  return tl;
};

// Button click ripple effect
export const createRipple = (event: React.MouseEvent | globalThis.MouseEvent, button: HTMLElement, color = 'rgba(0, 212, 255, 0.4)') => {
  const rect = button.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const ripple = document.createElement('span');
  ripple.style.cssText = `
    position: absolute;
    width: 20px;
    height: 20px;
    background: ${color};
    border-radius: 50%;
    left: ${x}px;
    top: ${y}px;
    pointer-events: none;
    transform: translate(-50%, -50%) scale(0);
  `;

  button.style.position = 'relative';
  button.style.overflow = 'hidden';
  button.appendChild(ripple);

  gsap.to(ripple, {
    scale: 15,
    opacity: 0,
    duration: 0.6,
    ease: 'power2.out',
    onComplete: () => ripple.remove()
  });
};

// Voice visualizer bars
export const animateVoiceBars = (bars: HTMLElement[], intensity = 1) => {
  bars.forEach((bar, i) => {
    gsap.to(bar, {
      scaleY: 0.3 + Math.random() * 0.7 * intensity,
      duration: 0.1 + Math.random() * 0.1,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: i * 0.02
    });
  });
};

// Stop voice animation
export const stopVoiceBars = (bars: HTMLElement[]) => {
  bars.forEach((bar) => {
    gsap.killTweensOf(bar);
    gsap.to(bar, {
      scaleY: 0.1,
      duration: 0.2,
      ease: 'power2.out'
    });
  });
};

// Float animation for ambient elements
export const createFloatAnimation = (element: HTMLElement | null, distance = 10, duration = 3) => {
  if (!element) return;

  gsap.to(element, {
    y: `+=${distance}`,
    duration: duration,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut'
  });
};

// Glitch effect for text
export const createGlitchEffect = (element: HTMLElement | null) => {
  if (!element) return;

  const tl = gsap.timeline({ repeat: 2 });

  tl.to(element, { x: -2, duration: 0.05 })
    .to(element, { x: 2, duration: 0.05 })
    .to(element, { x: -1, duration: 0.05 })
    .to(element, { x: 1, duration: 0.05 })
    .to(element, { x: 0, duration: 0.05 });

  return tl;
};

// Background grid animation
export const animateGridLines = (elements: HTMLElement[] | NodeListOf<Element>) => {
  gsap.fromTo(elements,
    { strokeDashoffset: 100 },
    {
      strokeDashoffset: 0,
      duration: 2,
      stagger: 0.1,
      ease: 'power2.inOut'
    }
  );
};

// Shake animation for errors
export const createShakeAnimation = (element: HTMLElement | null) => {
  if (!element) return;

  const tl = gsap.timeline();

  tl.to(element, { x: -5, duration: 0.05 })
    .to(element, { x: 5, duration: 0.05 })
    .to(element, { x: -5, duration: 0.05 })
    .to(element, { x: 5, duration: 0.05 })
    .to(element, { x: -3, duration: 0.05 })
    .to(element, { x: 3, duration: 0.05 })
    .to(element, { x: 0, duration: 0.05 });

  return tl;
};

// Fade up animation for content
export const fadeUp = (element: HTMLElement | null, delay = 0) => {
  if (!element) return;

  gsap.fromTo(element,
    { opacity: 0, y: 30 },
    {
      opacity: 1,
      y: 0,
      duration: 0.6,
      delay,
      ease: 'power2.out'
    }
  );
};

// Scale in animation
export const scaleIn = (element: HTMLElement | null, delay = 0) => {
  if (!element) return;

  gsap.fromTo(element,
    { opacity: 0, scale: 0.8 },
    {
      opacity: 1,
      scale: 1,
      duration: 0.5,
      delay,
      ease: 'back.out(1.5)'
    }
  );
};

// Export gsap for direct access
export { gsap, ScrollTrigger };
