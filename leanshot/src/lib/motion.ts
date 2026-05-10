/**
 * Motion vocabulary — three easings, four durations.
 * Mirror of CSS tokens; used by JS animations (framer-motion, requestAnimationFrame).
 */

export const easing = {
  /** Sharp out — entrances. cubic-bezier(0.25, 1, 0.5, 1) */
  outQuart: [0.25, 1, 0.5, 1] as const,
  /** Symmetric in-out — transitions between states. */
  inOutQuart: [0.76, 0, 0.24, 1] as const,
  /** Mild overshoot — delight. */
  spring: [0.34, 1.56, 0.64, 1] as const,
};

export const duration = {
  instant: 0.1,
  quick: 0.2,
  standard: 0.3,
  deliberate: 0.5,
};

/**
 * Standard card-rise transition for framer-motion.
 * Use with `<motion.div initial="hidden" animate="visible" variants={cardRise}>`.
 */
export const cardRise = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.deliberate, ease: easing.outQuart },
  },
};

export const stagger = (delay = 0.06) => ({
  hidden: {},
  visible: { transition: { staggerChildren: delay, delayChildren: 0.05 } },
});
